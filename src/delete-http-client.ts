import {getRetryLimit} from '@actions/artifact/lib/internal/config-variables';
import {ListArtifactsResponse, QueryArtifactResponse} from '@actions/artifact/lib/internal/contracts';
import {HttpManager} from '@actions/artifact/lib/internal/http-manager';
import {retryHttpClientRequest} from '@actions/artifact/lib/internal/requestUtils';
import {StatusReporter} from '@actions/artifact/lib/internal/status-reporter';
import {
    displayHttpDiagnostics,
    getApiVersion,
    getArtifactUrl,
    getExponentialRetryTimeInMilliseconds,
    isRetryableStatusCode,
    isSuccessStatusCode,
    isThrottledStatusCode,
    sleep,
    tryGetRetryAfterValueTimeInMilliseconds
} from '@actions/artifact/lib/internal/utils';
import * as core from '@actions/core';
import {IHeaders, IHttpClientResponse} from '@actions/http-client/interfaces';
import {performance} from 'perf_hooks';
import {URL} from 'url';

export const DELETE_CONCURRENCY = 2;

export function getDeleteHeaders(
    contentType: string,
    isKeepAlive?: boolean
): IHeaders {
    const requestOptions: IHeaders = {};

    if (contentType) {
        requestOptions['Content-Type'] = contentType;
    }
    if (isKeepAlive) {
        requestOptions['Connection'] = 'Keep-Alive';
        // keep alive for at least 10 seconds before closing the connection
        requestOptions['Keep-Alive'] = '10';
    }
    // default to application/json if we are not working with gzip content
    requestOptions['Accept'] = `application/json;api-version=${getApiVersion()}`;

    return requestOptions;
}


export class DeleteHttpClient {
    private deleteHttpManager: HttpManager;
    private statusReporter: StatusReporter;

    constructor() {
        this.deleteHttpManager = new HttpManager(
            DELETE_CONCURRENCY,
            '@actions/artifact-delete'
        );
        this.statusReporter = new StatusReporter(1000);
    }

    /**
     * Gets a list of all artifacts that are in a specific container
     */
    async listArtifacts(): Promise<ListArtifactsResponse> {
        const artifactUrl = getArtifactUrl();

        // use the first client from the httpManager, `keep-alive` is not used so the connection will close immediately
        const client = this.deleteHttpManager.getClient(0);
        const headers = getDeleteHeaders('application/json');
        const response = await retryHttpClientRequest('List Artifacts', async () =>
            client.get(artifactUrl, headers));
        const body: string = await response.readBody();
        return JSON.parse(body);
    }

    /**
     * Fetches a set of container items that describe the contents of an artifact
     * @param artifactName the name of the artifact
     * @param containerUrl the artifact container URL for the run
     */
    async getContainerItems(
        artifactName: string,
        containerUrl: string
    ): Promise<QueryArtifactResponse> {
        // the itemPath search parameter controls which containers will be returned
        const resourceUrl = new URL(containerUrl);
        resourceUrl.searchParams.append('itemPath', artifactName);

        // use the first client from the httpManager, `keep-alive` is not used so the connection will close immediately
        const client = this.deleteHttpManager.getClient(0);
        const headers = getDeleteHeaders('application/json');
        const response = await retryHttpClientRequest(
            'Get Container Items',
            async () => client.get(resourceUrl.toString(), headers)
        );
        const body: string = await response.readBody();
        return JSON.parse(body);
    }

    async deleteSingleArtifact(deleteItems: string[]): Promise<void> {
        // limit the number of files deleted at a single time
        core.debug(`Delete file concurrency is set to ${DELETE_CONCURRENCY}`);
        let parallelDeletes: any = (new Array(DELETE_CONCURRENCY).keys());
        parallelDeletes = [...parallelDeletes];
        let deletedFiles = 0;

        core.info(
            `Total number of files that will be deleted: ${deleteItems.length}`
        );

        this.statusReporter.setTotalNumberOfFilesToProcess(deleteItems.length);
        this.statusReporter.start();

        await Promise.all(parallelDeletes.map(async (index: number) => {
            for (const artifactLocation of deleteItems) {
                const startTime = performance.now();
                await this.deleteIndividualFile(index, artifactLocation);

                if (core.isDebug()) {
                    core.debug(
                        `File: ${++deletedFiles}/${deleteItems.length}. ${
                            artifactLocation
                        } took ${(performance.now() - startTime).toFixed(
                            3
                        )} milliseconds to finish delete`
                    );
                }

                this.statusReporter.incrementProcessedCount();
            }
        }))
            .catch(error => {
                throw new Error(`Unable to delete the artifact: ${error}`);
            })
            .finally(() => {
                this.statusReporter.stop();
                // safety dispose all connections
                this.deleteHttpManager.disposeAndReplaceAllClients();
            });
    }

    private async deleteIndividualFile(
        httpClientIndex: number,
        artifactLocation: string
    ): Promise<void> {
        let retryCount = 0;
        const retryLimit = getRetryLimit();
        const headers = getDeleteHeaders('application/json', true);

        const makeDeleteRequest = async (): Promise<IHttpClientResponse> => {
            const client = this.deleteHttpManager.getClient(httpClientIndex);
            return await client.del(artifactLocation, headers);
        };

        const backOff = async (retryAfterValue?: number): Promise<void> => {
            retryCount++;
            if (retryCount > retryLimit) {
                return Promise.reject(
                    new Error(`Retry limit has been reached. Unable to delete ${artifactLocation}`)
                );
            } else {
                this.deleteHttpManager.disposeAndReplaceClient(httpClientIndex);
                if (retryAfterValue) {
                    // Back off by waiting the specified time denoted by the retry-after header
                    core.info(`Backoff due to too many requests, retry #${
                        retryCount
                    }. Waiting for ${
                        retryAfterValue
                    } milliseconds before continuing the delete`);
                    await sleep(retryAfterValue);
                } else {
                    // Back off using an exponential value that depends on the retry count
                    const backoffTime = getExponentialRetryTimeInMilliseconds(retryCount);
                    core.info(`Exponential backoff for retry #${
                        retryCount
                    }. Waiting for ${
                        backoffTime
                    } milliseconds before continuing the delete`);
                    await sleep(backoffTime);
                }
                core.info(`Finished backoff for retry #${retryCount}, continuing with delete`);
            }
        };

        // keep trying to delete a file until a retry limit has been reached
        while (retryCount <= retryLimit) {
            let response: IHttpClientResponse;
            try {
                response = await makeDeleteRequest();
                if (core.isDebug()) {
                    displayHttpDiagnostics(response);
                }
            } catch (error) {
                // if an error is caught, it is usually indicative of a timeout so retry the delete
                core.info('An error occurred while attempting to delete a file');
                // eslint-disable-next-line no-console
                console.log(error);

                // increment the retryCount and use exponential backoff to wait before making the next request
                await backOff();
                continue;
            }

            if (isSuccessStatusCode(response.message.statusCode)) {
                return;
            } else if (isRetryableStatusCode(response.message.statusCode)) {
                core.info(`A ${
                    response.message.statusCode
                } response code has been received while attempting to delete an artifact`);
                // if a throttled status code is received, try to get the retryAfter header value, else differ to standard exponential backoff
                isThrottledStatusCode(response.message.statusCode)
                    ? await backOff(tryGetRetryAfterValueTimeInMilliseconds(response.message.headers))
                    : await backOff();
            } else {
                // Some unexpected response code, fail immediately and stop the delete
                displayHttpDiagnostics(response);
                return Promise.reject(
                    new Error(`Unexpected http ${response.message.statusCode} during delete for ${artifactLocation}`)
                );
            }
        }
    }
}

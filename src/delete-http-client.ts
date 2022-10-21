import {getRetryLimit} from '@actions/artifact/lib/internal/config-variables';
import {ArtifactResponse, ListArtifactsResponse} from '@actions/artifact/lib/internal/contracts';
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
import {HttpClientResponse} from '@actions/http-client';
import {OutgoingHttpHeaders} from 'http';
import {performance} from 'perf_hooks';

export const DELETE_CONCURRENCY = 2;

export function getDeleteHeaders(
    contentType: string,
    isKeepAlive?: boolean
): OutgoingHttpHeaders {
    const requestOptions: OutgoingHttpHeaders = {};

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

export interface DeleteArtifactStatus {
    status: 'success' | 'fail';
    containerId: string;
    size: number;
    type: string;
}

export interface DeleteArtifactsResponse {
    failed: {
        count: number;
        names: string[];
    };
    deleted: {
        count: number;
        names: string[];
    };
    artifacts: {
        [name: string]: DeleteArtifactStatus;
    }
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

    async deleteArtifacts(artifacts: ArtifactResponse[]): Promise<DeleteArtifactsResponse> {
        // limit the number of artifacts deleted at a single time
        core.debug(`Delete artifact concurrency is set to ${DELETE_CONCURRENCY}`);
        const parallelDeletes = [...new Array(DELETE_CONCURRENCY).keys()];
        const deletingArtifacts: Set<ArtifactResponse> = new Set<ArtifactResponse>();
        const result: DeleteArtifactsResponse = {
            failed: {
                count: 0,
                names: []
            },
            deleted: {
                count: 0,
                names: []
            },
            artifacts: {}
        };

        core.info(`Total number of artifacts that will be deleted: ${artifacts.length}`);

        this.statusReporter.setTotalNumberOfFilesToProcess(artifacts.length);
        this.statusReporter.start();

        try {
            await Promise.all(parallelDeletes.map(async (index: number) => {
                for (const artifact of artifacts) {
                    if (deletingArtifacts.has(artifact)) continue;
                    else deletingArtifacts.add(artifact);

                    const startTime = performance.now();
                    try {
                        await this.deleteSingleArtifact(index, artifact);

                        result.artifacts[artifact.name] = {
                            status: 'success',
                            size: artifact.size,
                            type: artifact.type,
                            containerId: artifact.containerId
                        };
                        result.deleted.count++;
                        result.deleted.names.push(artifact.name);
                    } catch (e) {
                        result.artifacts[artifact.name] = {
                            status: 'fail',
                            size: artifact.size,
                            type: artifact.type,
                            containerId: artifact.containerId
                        };
                        result.failed.count++;
                        result.failed.names.push(artifact.name);
                        continue;
                    }

                    if (core.isDebug()) {
                        core.debug(
                            `Artifact: ${result.deleted.count}/${artifacts.length}. ${
                                artifact.name
                            } took ${(performance.now() - startTime).toFixed(
                                3
                            )} milliseconds to finish delete`
                        );
                    }

                    this.statusReporter.incrementProcessedCount();

                    core.info(`Artifact ${artifact.name} was deleted`);
                }
            }));
        } catch (error) {
            throw new Error(`Unable to delete the artifact: ${error}`);
        } finally {
            this.statusReporter.stop();
            // safety dispose all connections
            this.deleteHttpManager.disposeAndReplaceAllClients();
        }

        return result;
    }

    private async deleteSingleArtifact(
        httpClientIndex: number,
        artifact: ArtifactResponse
    ): Promise<void> {
        let retryCount = 0;
        const retryLimit = getRetryLimit();
        const headers = getDeleteHeaders('application/json', true);

        const makeDeleteRequest = async (): Promise<HttpClientResponse> => {
            const client = this.deleteHttpManager.getClient(httpClientIndex);
            return await client.del(artifact.url, headers);
        };

        const backOff = async (retryAfterValue?: number): Promise<void> => {
            retryCount++;
            if (retryCount > retryLimit) {
                throw new Error(`Retry limit has been reached. Unable to delete ${artifact.name}`);
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

        // keep trying to delete an artifact until a retry limit has been reached
        while (retryCount <= retryLimit) {
            let response: HttpClientResponse;
            try {
                response = await makeDeleteRequest();
                if (core.isDebug()) {
                    displayHttpDiagnostics(response);
                }
            } catch (error) {
                // if an error is caught, it is usually indicative of a timeout so retry the delete
                core.info('An error occurred while attempting to delete an artifact');
                console.log(error);

                // increment the retryCount and use exponential backoff to wait before making the next request
                await backOff();
                continue;
            }

            if (isSuccessStatusCode(response.message.statusCode)) {
                await response.readBody();
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
                throw new Error(`Unexpected http ${response.message.statusCode} during delete for ${artifact.name}`);
            }
        }
    }
}

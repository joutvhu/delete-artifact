import {ListArtifactsResponse} from '@actions/artifact/lib/internal/contracts';
import * as core from '@actions/core';
import {Outputs} from './constants';
import {DeleteArtifactsResponse, DeleteHttpClient} from './delete-http-client';
import {DeleteInputs, getInputs} from './input-helper';

(async function run(): Promise<void> {
    try {
        const inputs: DeleteInputs = getInputs();
        const deleteHttpClient = new DeleteHttpClient();

        const artifacts: ListArtifactsResponse = await deleteHttpClient.listArtifacts();

        if (artifacts.count === 0 && !inputs.deleteAll) {
            throw new Error(`Unable to find any artifacts for the associated workflow`);
        }

        const artifactsToDelete = artifacts.value
            .filter(artifact =>
                inputs.deleteAll ||
                inputs.artifactNames.includes(artifact.name));

        if (artifactsToDelete.length !== inputs.artifactNames.length) {
            const artifactNamesToDelete = artifactsToDelete
                .map(artifact => artifact.name);
            const notFoundNames = inputs.artifactNames
                .filter(name => !artifactNamesToDelete.includes(name));

            if (notFoundNames.length > 0) {
                throw new Error(`Unable to find the following artifacts: ${notFoundNames.join(', ')}`);
            }
        }

        const response: DeleteArtifactsResponse = await deleteHttpClient.deleteArtifacts(artifactsToDelete);

        core.setOutput(Outputs.Failed, response[Outputs.Failed]);
        core.setOutput(Outputs.Deleted, response[Outputs.Deleted]);
        core.setOutput(Outputs.Artifacts, response[Outputs.Artifacts]);
        core.info('Artifact delete has finished successfully');
    } catch (err: any) {
        core.setFailed(err.message);
    }
})();

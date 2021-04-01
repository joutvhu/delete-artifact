import {ListArtifactsResponse} from '@actions/artifact/lib/internal/contracts';
import * as core from '@actions/core';
import {DeleteHttpClient} from './delete-http-client';
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

        for (const artifact of artifactsToDelete) {
            // Get container entries for the specific artifact
            const items = await deleteHttpClient.getContainerItems(
                artifact.name,
                artifact.fileContainerResourceUrl
            );

            const filesToDelete = items.value
                .filter(entry =>
                    entry.path.startsWith(`${artifact.name}/`) ||
                    entry.path.startsWith(`${artifact.name}\\`))
                .filter(entry => entry.itemType === 'file')
                .filter(entry => entry.fileLength !== 0)
                .map(entry => entry.contentLocation);

            if (filesToDelete.length === 0) {
                core.info(`No deletable files were found for any artifact ${artifact.name}`);
            } else {
                await deleteHttpClient.deleteSingleArtifact(filesToDelete);
                core.info(`Artifact ${artifact.name} was deleted`);
            }
        }

        core.info('Artifact delete has finished successfully');
    } catch (err) {
        core.setFailed(err.message);
    }
})();

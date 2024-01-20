import artifact, {Artifact, FindOptions, ListArtifactsResponse} from '@actions/artifact';
import * as core from '@actions/core';
import {context} from '@actions/github';
import {DeleteInputs, getInputs, isNotBlank, setOutputs} from './io-helper';

export interface DeleteStatus {
  status: 'success' | 'fail';
}

export interface DeleteResponse {
  failed: {
    count: number;
    names: string[];
  };
  deleted: {
    count: number;
    names: string[];
  };
  artifacts: {
    [name: string]: DeleteStatus & Artifact;
  }
}

(async function run(): Promise<void> {
  try {
    const inputs: DeleteInputs = getInputs();

    const findOptions: FindOptions = {};
    if (isNotBlank(inputs.runId) && isNotBlank(inputs.token)) {
      findOptions.findBy = {
        token: inputs.token as string,
        repositoryOwner: inputs.owner ?? context.repo.owner,
        repositoryName: inputs.repo ?? context.repo.repo,
        workflowRunId: inputs.runId as number
      };
    }

    const list: ListArtifactsResponse = await artifact.listArtifacts({
      findBy: findOptions.findBy,
      latest: inputs.latest
    });

    if (list.artifacts.length === 0 && !inputs.deleteAll) {
      throw new Error(`Unable to find any artifacts for the associated workflow`);
    }

    const artifactsToDelete: Artifact[] = inputs.deleteAll ? list.artifacts : list.artifacts
      .filter(artifact => inputs.artifactNames.includes(artifact.name));

    if (artifactsToDelete.length !== inputs.artifactNames.length) {
      const artifactNamesToDelete = artifactsToDelete
        .map(artifact => artifact.name);
      const notFoundNames = inputs.artifactNames
        .filter(name => !artifactNamesToDelete.includes(name));

      if (notFoundNames.length > 0) {
        throw new Error(`Unable to find the following artifacts: ${notFoundNames.join(', ')}`);
      }
    }

    core.info(`Total number of artifacts that will be deleted: ${artifactsToDelete.length}`);
    const result: DeleteResponse = {
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

    await Promise.all(artifactsToDelete.map(async (value) => {
      try {
        await artifact.deleteArtifact(value.name, findOptions);
        result.artifacts[value.name] = {
          ...value,
          status: 'success'
        };
        result.deleted.count++;
        result.deleted.names.push(value.name);
      } catch (e) {
        result.artifacts[value.name] = {
          ...value,
          status: 'fail'
        };
        result.failed.count++;
        result.failed.names.push(value.name);
      }
    }));

    setOutputs(result);
    core.info('Artifact delete has finished successfully');
  } catch (err: any) {
    core.setFailed(err.message);
  }
})();

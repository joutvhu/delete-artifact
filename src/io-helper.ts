import * as core from '@actions/core';
import {InputOptions} from '@actions/core';
import {Inputs, Outputs} from './constants';
import {FindOptions, ListArtifactsOptions} from '@actions/artifact';
import {context} from '@actions/github';

export class DeleteInputs {
  public owner?: string;
  public repo?: string;
  public runId?: number;
  public token?: string;
  public latest?: boolean;

  /**
   * The name of the artifacts that will be deleted
   */
  public artifactNames: string[];

  constructor(artifactNames: string[] = []) {
    this.artifactNames = artifactNames;
  }

  public get deleteAll(): boolean {
    return this.artifactNames == null || this.artifactNames.length === 0;
  }

  public get findOptions(): FindOptions {
    const options: ListArtifactsOptions & FindOptions = {};
    if (isNotBlank(this.runId) && isNotBlank(this.token)) {
      options.findBy = {
        token: this.token as string,
        repositoryOwner: this.owner ?? context.repo.owner,
        repositoryName: this.repo ?? context.repo.repo,
        workflowRunId: this.runId as number
      };
    }
    if (this.latest != null) {
      options.latest = this.latest;
    }
    return options;
  }

  public get listOptions(): ListArtifactsOptions & FindOptions {
    const options: ListArtifactsOptions & FindOptions = {};
    if (isNotBlank(this.runId) && isNotBlank(this.token)) {
      options.findBy = {
        token: this.token as string,
        repositoryOwner: this.owner ?? context.repo.owner,
        repositoryName: this.repo ?? context.repo.repo,
        workflowRunId: this.runId as number
      };
    }
    if (this.latest != null) {
      options.latest = this.latest;
    }
    return options;
  }
}

export function isNotBlank(value: any): boolean {
  return value !== null && value !== undefined && (value.length === undefined || value.length > 0);
}

export function getBooleanInput(name: string, options?: InputOptions): boolean {
  const value = core.getInput(name, options);
  return isNotBlank(value) &&
    ['y', 'yes', 't', 'true', 'e', 'enable', 'enabled', 'on', 'ok', '1']
      .includes(value.trim().toLowerCase());
}

/**
 * Helper to get all the inputs for the action
 */
export function getInputs(): DeleteInputs {
  const names = core.getInput(Inputs.Name, {required: false});
  const result: DeleteInputs = new DeleteInputs();

  const owner = core.getInput(Inputs.Owner, {required: false});
  if (isNotBlank(owner))
    result.owner = owner;

  const repo = core.getInput(Inputs.Repo, {required: false});
  if (isNotBlank(repo))
    result.repo = repo;

  const runId = core.getInput(Inputs.RunId, {required: false});
  if (isNotBlank(runId) && /^\d+$/.test(runId))
    result.runId = parseInt(runId, 10);

  const token = core.getInput(Inputs.Token, {required: false});
  if (isNotBlank(token))
    result.token = token;

  result.latest = getBooleanInput(Inputs.Latest, {required: false});

  if (names != null && names.length > 0) {
    result.artifactNames = names
      .split(/\r?\n/)
      .map(name => name.trim())
      .filter(name => name.length > 0);
  }

  return result;
}

export function setOutputs(response: any, log?: boolean) {
  // Get the outputs for the created release from the response
  let message = '';
  for (const key in Outputs) {
    const field: string = (Outputs as any)[key];
    if (log)
      message += `\n  ${field}: ${JSON.stringify(response[field])}`;
    core.setOutput(field, response[field]);
  }

  if (log)
    core.info('Outputs:' + message);
}


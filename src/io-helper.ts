import * as core from '@actions/core';
import {InputOptions} from '@actions/core';
import {Inputs, Outputs} from './constants';
import {Minimatch} from 'minimatch';

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
  public pattern?: Minimatch;

  constructor(artifactNames: string[] = []) {
    this.artifactNames = artifactNames;
  }

  public get hasNames(): boolean {
    return this.artifactNames != null && this.artifactNames.length > 0;
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
  const result: DeleteInputs = new DeleteInputs();

  const names = core.getInput(Inputs.Name, {required: false});
  if (names != null && names.length > 0) {
    result.artifactNames = names
      .split(/\r?\n/)
      .map(name => name.trim())
      .filter(name => name.length > 0);
  }

  const pattern = core.getInput(Inputs.Pattern, {required: false});
  if (isNotBlank(pattern))
    result.pattern = new Minimatch(pattern);

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


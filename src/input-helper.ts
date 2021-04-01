import * as core from '@actions/core';
import {Inputs} from './constants';

export class DeleteInputs {
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
}

/**
 * Helper to get all the inputs for the action
 */
export function getInputs(): DeleteInputs {
    const names = core.getInput(Inputs.Name, {required: false});
    const result: DeleteInputs = new DeleteInputs();

    if (names != null && names.length > 0) {
        result.artifactNames = names
            .split(/\r?\n/)
            .map(name => name.trim())
            .filter(name => name.length > 0);
    }

    return result;
}

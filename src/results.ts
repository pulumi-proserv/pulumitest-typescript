// Copyright 2026, Pulumi Corporation.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Result classes for Pulumi operations.
 *
 * Each result wraps the corresponding Pulumi Automation API result and adds
 * assertion methods that throw an AssertionError directly (works with any
 * test framework, or standalone).
 */

import { AssertionError } from "node:assert";
import type * as auto from "@pulumi/pulumi/automation";

export type OpType = auto.OpType;
export type OpMap = auto.OpMap;

const DELETE_OPS: OpType[] = ["delete", "delete-replaced"];

const REPLACEMENT_OPS: OpType[] = [
    "replace",
    "create-replacement",
    "delete-replaced",
    "discard-replaced",
    "import-replacement",
    "read-replacement",
];

/** Helper for filtering operation counts. */
export class ChangeSummary {
    constructor(public readonly changeSummary: OpMap) {}

    whereOpNotEquals(...opTypes: OpType[]): OpMap {
        const result: OpMap = {};
        for (const [op, count] of Object.entries(this.changeSummary)) {
            if (!opTypes.includes(op as OpType)) {
                result[op as OpType] = count;
            }
        }
        return result;
    }

    whereOpEquals(...opTypes: OpType[]): OpMap {
        const result: OpMap = {};
        for (const [op, count] of Object.entries(this.changeSummary)) {
            if (opTypes.includes(op as OpType)) {
                result[op as OpType] = count;
            }
        }
        return result;
    }
}

function isEmpty(opMap: OpMap): boolean {
    return Object.keys(opMap).length === 0;
}

function fail(message: string, opMap: OpMap, stdout: string): never {
    throw new AssertionError({
        message: `${message}, got ${JSON.stringify(opMap)}\n${stdout}`,
    });
}

function assertNoDeletes(opMap: OpMap, stdout: string): void {
    const deletes = new ChangeSummary(opMap).whereOpEquals(...DELETE_OPS);
    if (!isEmpty(deletes)) {
        fail("expected no deletes", deletes, stdout);
    }
}

function assertNoChanges(opMap: OpMap, stdout: string): void {
    const unexpected = new ChangeSummary(opMap).whereOpNotEquals("same");
    if (!isEmpty(unexpected)) {
        fail("expected no changes", unexpected, stdout);
    }
}

function assertNoReplacements(opMap: OpMap, stdout: string): void {
    const replacements = new ChangeSummary(opMap).whereOpEquals(...REPLACEMENT_OPS);
    if (!isEmpty(replacements)) {
        fail("expected no replacements", replacements, stdout);
    }
}

export class PreviewResult {
    constructor(public readonly previewResult: auto.PreviewResult) {}

    get changeSummary(): OpMap {
        return this.previewResult.changeSummary;
    }

    hasNoDeletes(): void {
        assertNoDeletes(this.previewResult.changeSummary, this.previewResult.stdout);
    }

    hasNoChanges(): void {
        assertNoChanges(this.previewResult.changeSummary, this.previewResult.stdout);
    }

    hasNoReplacements(): void {
        assertNoReplacements(this.previewResult.changeSummary, this.previewResult.stdout);
    }
}

export class RefreshResult {
    constructor(public readonly refreshResult: auto.RefreshResult) {}

    get changeSummary(): OpMap | undefined {
        return this.refreshResult.summary.resourceChanges;
    }

    get summary(): auto.UpdateSummary {
        return this.refreshResult.summary;
    }

    hasNoChanges(): void {
        const resourceChanges = this.refreshResult.summary.resourceChanges;
        if (resourceChanges === undefined) {
            return;
        }
        assertNoChanges(resourceChanges, this.refreshResult.stdout);
    }
}

export class UpdateResult {
    constructor(public readonly updateResult: auto.UpResult) {}

    get outputs(): auto.OutputMap {
        return this.updateResult.outputs;
    }

    get summary(): auto.UpdateSummary {
        return this.updateResult.summary;
    }

    get changeSummary(): OpMap | undefined {
        return this.updateResult.summary.resourceChanges;
    }

    hasNoDeletes(): void {
        const resourceChanges = this.updateResult.summary.resourceChanges;
        if (resourceChanges === undefined) {
            return;
        }
        assertNoDeletes(resourceChanges, this.updateResult.stdout);
    }

    hasNoChanges(): void {
        const resourceChanges = this.updateResult.summary.resourceChanges;
        if (resourceChanges === undefined) {
            return;
        }
        assertNoChanges(resourceChanges, this.updateResult.stdout);
    }

    hasNoReplacements(): void {
        const resourceChanges = this.updateResult.summary.resourceChanges;
        if (resourceChanges === undefined) {
            return;
        }
        assertNoReplacements(resourceChanges, this.updateResult.stdout);
    }
}

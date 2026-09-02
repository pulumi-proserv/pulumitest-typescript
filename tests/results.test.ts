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

/** Test result assertion methods using fake Pulumi results. */

import { AssertionError } from "node:assert";
import { describe, expect, it } from "vitest";
import type * as auto from "@pulumi/pulumi/automation";

import { ChangeSummary, PreviewResult, RefreshResult, UpdateResult } from "../src/results";

function summary(resourceChanges?: auto.OpMap): auto.UpdateSummary {
    return { resourceChanges } as unknown as auto.UpdateSummary;
}

function previewResult(changeSummary: auto.OpMap, stdout = ""): auto.PreviewResult {
    return { stdout, stderr: "", changeSummary };
}

function upResult(resourceChanges?: auto.OpMap, stdout = ""): auto.UpResult {
    return { stdout, stderr: "", outputs: {}, summary: summary(resourceChanges) };
}

function refreshResult(resourceChanges?: auto.OpMap, stdout = ""): auto.RefreshResult {
    return { stdout, stderr: "", summary: summary(resourceChanges) };
}

describe("ChangeSummary", () => {
    it("whereOpNotEquals filters out the given ops", () => {
        const cs = new ChangeSummary({ same: 3, create: 1 });
        expect(cs.whereOpNotEquals("same")).toEqual({ create: 1 });
    });

    it("whereOpNotEquals returns empty when everything is filtered", () => {
        const cs = new ChangeSummary({ same: 5 });
        expect(cs.whereOpNotEquals("same")).toEqual({});
    });

    it("whereOpEquals keeps only the given ops", () => {
        const cs = new ChangeSummary({ same: 3, delete: 1, "delete-replaced": 2 });
        expect(cs.whereOpEquals("delete", "delete-replaced")).toEqual({ delete: 1, "delete-replaced": 2 });
    });
});

describe("PreviewResult", () => {
    it("hasNoChanges passes when only same ops exist", () => {
        new PreviewResult(previewResult({ same: 3 })).hasNoChanges();
    });

    it("hasNoChanges fails when other ops exist", () => {
        const result = new PreviewResult(previewResult({ same: 3, create: 1 }, "output"));
        expect(() => result.hasNoChanges()).toThrow(AssertionError);
        expect(() => result.hasNoChanges()).toThrow(/expected no changes/);
        expect(() => result.hasNoChanges()).toThrow(/output/);
    });

    it("hasNoDeletes passes when no delete-type ops exist", () => {
        new PreviewResult(previewResult({ same: 3, create: 1 })).hasNoDeletes();
    });

    it("hasNoDeletes fails when delete-type ops are present", () => {
        const result = new PreviewResult(previewResult({ same: 3, delete: 1 }, "output"));
        expect(() => result.hasNoDeletes()).toThrow(/expected no deletes/);
    });

    it("hasNoReplacements passes when no replacement ops exist", () => {
        new PreviewResult(previewResult({ same: 3, update: 1 })).hasNoReplacements();
    });

    it("hasNoReplacements fails when replacement ops are present", () => {
        const result = new PreviewResult(previewResult({ same: 3, replace: 1 }));
        expect(() => result.hasNoReplacements()).toThrow(/expected no replacements/);
    });

    it("exposes changeSummary", () => {
        expect(new PreviewResult(previewResult({ same: 2 })).changeSummary).toEqual({ same: 2 });
    });
});

describe("UpdateResult", () => {
    it("hasNoChanges passes when resourceChanges is undefined", () => {
        new UpdateResult(upResult(undefined)).hasNoChanges();
    });

    it("hasNoChanges passes when only same ops exist", () => {
        new UpdateResult(upResult({ same: 5 })).hasNoChanges();
    });

    it("hasNoChanges fails when other ops exist", () => {
        const result = new UpdateResult(upResult({ same: 3, update: 1 }, "output"));
        expect(() => result.hasNoChanges()).toThrow(/expected no changes/);
    });

    it("hasNoDeletes passes when resourceChanges is undefined", () => {
        new UpdateResult(upResult(undefined)).hasNoDeletes();
    });

    it("hasNoDeletes fails when delete ops are present", () => {
        const result = new UpdateResult(upResult({ "delete-replaced": 1 }));
        expect(() => result.hasNoDeletes()).toThrow(/expected no deletes/);
    });

    it("hasNoReplacements passes when resourceChanges is undefined", () => {
        new UpdateResult(upResult(undefined)).hasNoReplacements();
    });

    it("hasNoReplacements fails when replacement ops are present", () => {
        const result = new UpdateResult(upResult({ "create-replacement": 1 }));
        expect(() => result.hasNoReplacements()).toThrow(/expected no replacements/);
    });

    it("exposes outputs, summary and changeSummary", () => {
        const raw = upResult({ create: 1 });
        raw.outputs = { key: { value: "value", secret: false } };
        const result = new UpdateResult(raw);
        expect(result.outputs).toEqual({ key: { value: "value", secret: false } });
        expect(result.summary).toBe(raw.summary);
        expect(result.changeSummary).toEqual({ create: 1 });
    });
});

describe("RefreshResult", () => {
    it("hasNoChanges passes when resourceChanges is undefined", () => {
        new RefreshResult(refreshResult(undefined)).hasNoChanges();
    });

    it("hasNoChanges passes when only same ops exist", () => {
        new RefreshResult(refreshResult({ same: 2 })).hasNoChanges();
    });

    it("hasNoChanges fails when other ops exist", () => {
        const result = new RefreshResult(refreshResult({ same: 2, update: 1 }, "output"));
        expect(() => result.hasNoChanges()).toThrow(/expected no changes/);
    });

    it("exposes summary and changeSummary", () => {
        const raw = refreshResult({ same: 2 });
        const result = new RefreshResult(raw);
        expect(result.summary).toBe(raw.summary);
        expect(result.changeSummary).toEqual({ same: 2 });
    });
});

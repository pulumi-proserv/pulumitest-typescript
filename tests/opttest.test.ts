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

import { describe, expect, it } from "vitest";

import * as opttest from "../src/opttest";

describe("opttest", () => {
    it("has sensible defaults", () => {
        const opts = opttest.defaultOptions();
        expect(opts.stackName).toBe("test");
        expect(opts.skipInstall).toBe(false);
        expect(opts.skipStackCreate).toBe(false);
        expect(opts.testInPlace).toBe(false);
        expect(opts.configPassphrase).toBe("correct horse battery staple");
        expect(opts.useAmbientBackend).toBe(false);
        expect(opts.customEnv).toEqual({});
    });

    it("stackName sets the stack name", () => {
        const opts = opttest.defaultOptions();
        opttest.stackName("custom")(opts);
        expect(opts.stackName).toBe("custom");
    });

    it("skipInstall sets skipInstall", () => {
        const opts = opttest.defaultOptions();
        opttest.skipInstall()(opts);
        expect(opts.skipInstall).toBe(true);
    });

    it("skipStackCreate sets skipStackCreate", () => {
        const opts = opttest.defaultOptions();
        opttest.skipStackCreate()(opts);
        expect(opts.skipStackCreate).toBe(true);
    });

    it("testInPlace sets testInPlace", () => {
        const opts = opttest.defaultOptions();
        opttest.testInPlace()(opts);
        expect(opts.testInPlace).toBe(true);
    });

    it("tempDir sets the temp directory", () => {
        const opts = opttest.defaultOptions();
        opttest.tempDir("/tmp/custom")(opts);
        expect(opts.tempDir).toBe("/tmp/custom");
    });

    it("configPassphrase sets the passphrase", () => {
        const opts = opttest.defaultOptions();
        opttest.configPassphrase("secret")(opts);
        expect(opts.configPassphrase).toBe("secret");
    });

    it("useAmbientBackend sets useAmbientBackend", () => {
        const opts = opttest.defaultOptions();
        opttest.useAmbientBackend()(opts);
        expect(opts.useAmbientBackend).toBe(true);
    });

    it("env adds a custom environment variable", () => {
        const opts = opttest.defaultOptions();
        opttest.env("FOO", "bar")(opts);
        expect(opts.customEnv).toEqual({ FOO: "bar" });
    });

    it("copyOptions produces an independent copy", () => {
        const opts = opttest.defaultOptions();
        opts.customEnv["KEY"] = "val";
        const copied = opttest.copyOptions(opts);
        copied.customEnv["KEY2"] = "val2";
        expect(opts.customEnv).not.toHaveProperty("KEY2");
        expect(copied.customEnv).toEqual({ KEY: "val", KEY2: "val2" });
    });

    it("applyOptions applies multiple options in order", () => {
        const opts = opttest.applyOptions(opttest.defaultOptions(), [
            opttest.stackName("prod"),
            opttest.skipInstall(),
            opttest.testInPlace(),
        ]);
        expect(opts.stackName).toBe("prod");
        expect(opts.skipInstall).toBe(true);
        expect(opts.testInPlace).toBe(true);
    });
});

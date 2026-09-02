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

/** Test PulumiProgram construction (no cloud credentials needed). */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const workspace = { install: vi.fn(async () => {}) };
    const stack = {
        name: "test",
        destroy: vi.fn(async () => ({})),
        up: vi.fn(async () => ({ stdout: "", stderr: "", outputs: {}, summary: {} })),
        preview: vi.fn(async () => ({ stdout: "", stderr: "", changeSummary: {} })),
        refresh: vi.fn(async () => ({ stdout: "", stderr: "", summary: {} })),
        addEnvironments: vi.fn(async () => {}),
    };
    return {
        workspace,
        stack,
        LocalWorkspace: {
            create: vi.fn(async () => workspace),
            createOrSelectStack: vi.fn(async () => stack),
        },
    };
});

vi.mock("@pulumi/pulumi/automation", () => ({
    LocalWorkspace: mocks.LocalWorkspace,
}));

import * as pulumitest from "../src/index";
import { PulumiProgram, opttest } from "../src/index";
import type { Logger } from "../src/index";

const silentLogger: Logger = { info: () => {}, error: () => {} };

function quietProgram(...opts: opttest.Option[]): Promise<PulumiProgram> {
    return PulumiProgram.create("test_stack", { logger: silentLogger }, ...opts);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.stack.destroy.mockResolvedValue({});
});

describe("PulumiProgram.create", () => {
    it("exports the public API", () => {
        expect(pulumitest.PulumiProgram).toBeDefined();
        expect(pulumitest.opttest).toBeDefined();
        expect(pulumitest.UpdateResult).toBeDefined();
        expect(pulumitest.PreviewResult).toBeDefined();
        expect(pulumitest.RefreshResult).toBeDefined();
    });

    it("initializes without copying or creating a stack", async () => {
        const program = await quietProgram(
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
        );

        expect(program.workingDir).toBe("test_stack");
        expect(program.options.testInPlace).toBe(true);
        expect(program.options.skipInstall).toBe(true);
        expect(program.options.skipStackCreate).toBe(true);
        expect(program.currentStack).toBeUndefined();
        expect(program.localWorkspace).toBe(mocks.workspace);
        expect(mocks.LocalWorkspace.create).toHaveBeenCalledWith(
            expect.objectContaining({ workDir: "test_stack" }),
        );
        expect(mocks.workspace.install).not.toHaveBeenCalled();
        expect(mocks.LocalWorkspace.createOrSelectStack).not.toHaveBeenCalled();
    });

    it("creates a stack when not skipped", async () => {
        const program = await quietProgram(opttest.testInPlace(), opttest.skipInstall());

        expect(program.currentStack).toBe(mocks.stack);
        expect(mocks.LocalWorkspace.createOrSelectStack).toHaveBeenCalledWith(
            { stackName: "test", workDir: "test_stack" },
            expect.anything(),
        );
    });

    it("passes env vars to the workspace and stack", async () => {
        const program = await quietProgram(
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.env("PULUMI_BACKEND_URL", "file:///tmp/test-backend"),
            opttest.env("MY_CUSTOM_VAR", "hello"),
        );

        const expected = {
            PULUMI_BACKEND_URL: "file:///tmp/test-backend",
            PULUMI_CONFIG_PASSPHRASE: "correct horse battery staple",
            MY_CUSTOM_VAR: "hello",
        };
        expect(program.getEnvVars()).toEqual(expected);
        expect(mocks.LocalWorkspace.create).toHaveBeenCalledWith({
            workDir: "test_stack",
            envVars: expected,
        });
        expect(mocks.LocalWorkspace.createOrSelectStack).toHaveBeenCalledWith(
            { stackName: "test", workDir: "test_stack" },
            { envVars: expected },
        );
    });

    it("drops empty env vars before passing them to the workspace", async () => {
        const saved = process.env.PULUMI_BACKEND_URL;
        delete process.env.PULUMI_BACKEND_URL;
        try {
            await quietProgram(opttest.testInPlace(), opttest.skipInstall(), opttest.skipStackCreate());
        } finally {
            if (saved !== undefined) process.env.PULUMI_BACKEND_URL = saved;
        }

        expect(mocks.LocalWorkspace.create).toHaveBeenCalledWith({
            workDir: "test_stack",
            envVars: { PULUMI_CONFIG_PASSPHRASE: "correct horse battery staple" },
        });
    });

    it("runs install when not skipped", async () => {
        await quietProgram(opttest.testInPlace(), opttest.skipStackCreate());
        expect(mocks.workspace.install).toHaveBeenCalledOnce();
    });

    it("uses a custom stack name", async () => {
        await quietProgram(opttest.testInPlace(), opttest.skipInstall(), opttest.stackName("custom"));

        expect(mocks.LocalWorkspace.createOrSelectStack).toHaveBeenCalledWith(
            { stackName: "custom", workDir: "test_stack" },
            expect.anything(),
        );
    });

    it("accepts options without an args object", async () => {
        const program = await PulumiProgram.create(
            "test_stack",
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
        );
        expect(program.options.skipStackCreate).toBe(true);
    });

    it("exposes env vars", async () => {
        const program = await quietProgram(
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
        );

        const envVars = program.getEnvVars();
        expect(envVars).toHaveProperty("PULUMI_CONFIG_PASSPHRASE", "correct horse battery staple");
        expect(envVars).toHaveProperty("PULUMI_BACKEND_URL");
    });

    it("uses a custom config passphrase", async () => {
        const program = await quietProgram(
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
            opttest.configPassphrase("hunter2"),
        );
        expect(program.getEnvVars().PULUMI_CONFIG_PASSPHRASE).toBe("hunter2");
    });
});

describe("PulumiProgram operations", () => {
    it("throws when the stack is not initialized", async () => {
        const program = await quietProgram(
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
        );
        await expect(program.up()).rejects.toThrow("Stack not initialized");
        await expect(program.preview()).rejects.toThrow("Stack not initialized");
        await expect(program.refresh()).rejects.toThrow("Stack not initialized");
        await expect(program.destroy()).rejects.toThrow("Stack not initialized");
        await expect(program.addEnvironments("a/b")).rejects.toThrow("Stack not initialized");
    });

    it("wraps up, preview and refresh results", async () => {
        const program = await quietProgram(opttest.testInPlace(), opttest.skipInstall());
        const up = await program.up();
        expect(up.updateResult).toEqual({ stdout: "", stderr: "", outputs: {}, summary: {} });
        const preview = await program.preview();
        expect(preview.changeSummary).toEqual({});
        const refresh = await program.refresh();
        expect(refresh.summary).toEqual({});
    });

    it("forwards addEnvironments to the stack", async () => {
        const program = await quietProgram(opttest.testInPlace(), opttest.skipInstall());
        await program.addEnvironments("aws/dev", "shared/base");
        expect(mocks.stack.addEnvironments).toHaveBeenCalledWith("aws/dev", "shared/base");
    });
});

describe("PulumiProgram.cleanup", () => {
    it("is safe when no stack exists", async () => {
        const program = await quietProgram(
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
        );
        await program.cleanup();
        await program.cleanup(true);
        expect(mocks.stack.destroy).not.toHaveBeenCalled();
    });

    it("destroys and removes the stack", async () => {
        const program = await quietProgram(opttest.testInPlace(), opttest.skipInstall());
        await program.cleanup();
        expect(mocks.stack.destroy).toHaveBeenCalledWith({ remove: true });
    });

    it("swallows destroy errors by default", async () => {
        const errors: string[] = [];
        const program = await PulumiProgram.create(
            "test_stack",
            { logger: { info: () => {}, error: (m) => errors.push(m) } },
            opttest.testInPlace(),
            opttest.skipInstall(),
        );
        mocks.stack.destroy.mockRejectedValueOnce(new Error("destroy failed: resource still in use"));

        await program.cleanup();

        expect(mocks.stack.destroy).toHaveBeenCalledWith({ remove: true });
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/Destroy failed for stack 'test'/);
        expect(errors[0]).toMatch(/destroy failed: resource still in use/);
    });

    it("re-throws destroy errors when requested", async () => {
        const program = await quietProgram(opttest.testInPlace(), opttest.skipInstall());
        mocks.stack.destroy.mockRejectedValueOnce(new Error("destroy failed: resource still in use"));

        await expect(program.cleanup(true)).rejects.toThrow("destroy failed");
        expect(mocks.stack.destroy).toHaveBeenCalledWith({ remove: true });
    });
});

describe("PulumiProgram file operations", () => {
    let sandbox: string;
    let source: string;

    beforeEach(() => {
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pulumitest-"));
        source = path.join(sandbox, "my_program");
        fs.mkdirSync(path.join(source, "nested"), { recursive: true });
        fs.writeFileSync(path.join(source, "Pulumi.yaml"), "name: my_program\nruntime: nodejs\n");
        fs.writeFileSync(path.join(source, "index.ts"), "// v1\n");
        fs.writeFileSync(path.join(source, "nested", "file.txt"), "nested\n");
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it("copies the program to a temp directory by default", async () => {
        const tempDir = path.join(sandbox, "tmp");
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.skipStackCreate(),
            opttest.tempDir(tempDir),
        );

        expect(program.workingDir).not.toBe(source);
        expect(path.basename(program.workingDir)).toBe("my_program");
        expect(path.dirname(path.dirname(program.workingDir))).toBe(tempDir);
        expect(path.basename(path.dirname(program.workingDir))).toMatch(/^programDir_[0-9a-f]{8}$/);
        expect(fs.readFileSync(path.join(program.workingDir, "index.ts"), "utf8")).toBe("// v1\n");
        expect(fs.readFileSync(path.join(program.workingDir, "nested", "file.txt"), "utf8")).toBe("nested\n");
        expect(mocks.LocalWorkspace.create).toHaveBeenCalledWith(
            expect.objectContaining({ workDir: program.workingDir }),
        );
    });

    it("updateSource replaces files but preserves project and state files", async () => {
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.skipStackCreate(),
            opttest.tempDir(path.join(sandbox, "tmp")),
        );
        fs.mkdirSync(path.join(program.workingDir, ".pulumi"));
        fs.writeFileSync(path.join(program.workingDir, ".pulumi", "state"), "state\n");

        const modified = path.join(sandbox, "modified");
        fs.mkdirSync(path.join(modified, ".pulumi"), { recursive: true });
        fs.writeFileSync(path.join(modified, "Pulumi.yaml"), "name: SHOULD_NOT_COPY\n");
        fs.writeFileSync(path.join(modified, "Pulumi.test.yaml"), "config: {}\n");
        fs.writeFileSync(path.join(modified, ".pulumi", "state"), "SHOULD_NOT_COPY\n");
        fs.writeFileSync(path.join(modified, "index.ts"), "// v2\n");
        fs.writeFileSync(path.join(modified, "extra.ts"), "// extra\n");

        program.updateSource(modified);

        const read = (p: string) => fs.readFileSync(path.join(program.workingDir, p), "utf8");
        expect(read("index.ts")).toBe("// v2\n");
        expect(read("extra.ts")).toBe("// extra\n");
        expect(read("Pulumi.yaml")).toBe("name: my_program\nruntime: nodejs\n");
        expect(read(path.join(".pulumi", "state"))).toBe("state\n");
        expect(fs.existsSync(path.join(program.workingDir, "Pulumi.test.yaml"))).toBe(false);
    });

    it("copyTo creates an in-place program in the target directory", async () => {
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
        );

        const target = path.join(sandbox, "copy");
        const copy = await program.copyTo(target, opttest.stackName("copied"));

        expect(copy.workingDir).toBe(target);
        expect(copy.options.testInPlace).toBe(true);
        expect(copy.options.skipInstall).toBe(true);
        expect(copy.options.stackName).toBe("copied");
        expect(program.options.stackName).toBe("test");
        expect(copy.logger).toBe(program.logger);
        expect(fs.readFileSync(path.join(target, "index.ts"), "utf8")).toBe("// v1\n");
    });

    it("copyToTempDir creates a program under the temp directory", async () => {
        const tempDir = path.join(sandbox, "tmp");
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
            opttest.tempDir(tempDir),
        );

        const copy = await program.copyToTempDir();

        expect(copy.options.testInPlace).toBe(true);
        expect(path.dirname(path.dirname(copy.workingDir))).toBe(tempDir);
        expect(fs.readFileSync(path.join(copy.workingDir, "index.ts"), "utf8")).toBe("// v1\n");
    });
});

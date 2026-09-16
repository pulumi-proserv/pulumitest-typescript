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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    class StackAlreadyExistsError extends Error {}
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
        StackAlreadyExistsError,
        LocalWorkspace: {
            create: vi.fn(async () => workspace),
            createStack: vi.fn(async () => stack),
            selectStack: vi.fn(async () => stack),
        },
    };
});

vi.mock("@pulumi/pulumi/automation", () => ({
    LocalWorkspace: mocks.LocalWorkspace,
    StackAlreadyExistsError: mocks.StackAlreadyExistsError,
}));

import * as pulumitest from "../src/index";
import { PulumiProgram, opttest } from "../src/index";
import type { Logger } from "../src/index";

const silentLogger: Logger = { info: () => {}, error: () => {} };

// Every program in this file gets its temp and backend directories under one
// sandbox so nothing is written into the repository's ./tmp.
let tmpBase: string;

function quietProgram(...opts: opttest.Option[]): Promise<PulumiProgram> {
    return PulumiProgram.create("test_stack", { logger: silentLogger }, opttest.tempDir(tmpBase), ...opts);
}

beforeAll(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "pulumitest-base-"));
});

afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.stack.destroy.mockResolvedValue({});
    mocks.LocalWorkspace.createStack.mockResolvedValue(mocks.stack);
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
        expect(mocks.LocalWorkspace.createStack).not.toHaveBeenCalled();
        expect(mocks.LocalWorkspace.selectStack).not.toHaveBeenCalled();
    });

    it("creates a stack when not skipped", async () => {
        const program = await quietProgram(opttest.testInPlace(), opttest.skipInstall());

        expect(program.currentStack).toBe(mocks.stack);
        expect(program.stackPreexisted).toBe(false);
        expect(mocks.LocalWorkspace.createStack).toHaveBeenCalledWith(
            { stackName: "test", workDir: "test_stack" },
            expect.anything(),
        );
        expect(mocks.LocalWorkspace.selectStack).not.toHaveBeenCalled();
    });

    it("selects a pre-existing stack and records that it was not created", async () => {
        mocks.LocalWorkspace.createStack.mockRejectedValueOnce(new mocks.StackAlreadyExistsError("exists"));

        const program = await quietProgram(opttest.testInPlace(), opttest.skipInstall());

        expect(program.currentStack).toBe(mocks.stack);
        expect(program.stackPreexisted).toBe(true);
        expect(mocks.LocalWorkspace.selectStack).toHaveBeenCalledWith(
            { stackName: "test", workDir: "test_stack" },
            expect.anything(),
        );
    });

    it("re-throws stack creation errors other than already-exists", async () => {
        mocks.LocalWorkspace.createStack.mockRejectedValueOnce(new Error("backend unreachable"));

        await expect(quietProgram(opttest.testInPlace(), opttest.skipInstall())).rejects.toThrow(
            "backend unreachable",
        );
        expect(mocks.LocalWorkspace.selectStack).not.toHaveBeenCalled();
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
        expect(mocks.LocalWorkspace.createStack).toHaveBeenCalledWith(
            { stackName: "test", workDir: "test_stack" },
            { envVars: expected },
        );
    });

    it("uses a private local file backend by default", async () => {
        const program = await quietProgram(
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
        );

        const url = program.getEnvVars().PULUMI_BACKEND_URL;
        expect(url).toMatch(/^file:\/\//);
        const dir = decodeURIComponent(new URL(url).pathname);
        expect(fs.existsSync(dir)).toBe(true);
        expect(path.dirname(dir)).toBe(tmpBase);
        if (process.platform !== "win32") {
            expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
        }
    });

    it("leaves the backend unset when useAmbientBackend is given", async () => {
        const saved = process.env.PULUMI_BACKEND_URL;
        delete process.env.PULUMI_BACKEND_URL;
        try {
            await quietProgram(
                opttest.testInPlace(),
                opttest.skipInstall(),
                opttest.skipStackCreate(),
                opttest.useAmbientBackend(),
            );
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

        expect(mocks.LocalWorkspace.createStack).toHaveBeenCalledWith(
            { stackName: "custom", workDir: "test_stack" },
            expect.anything(),
        );
    });

    it("accepts options without an args object", async () => {
        const program = await PulumiProgram.create(
            "test_stack",
            opttest.tempDir(tmpBase),
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

    it("refuses to destroy a stack that existed before the run", async () => {
        const infos: string[] = [];
        mocks.LocalWorkspace.createStack.mockRejectedValueOnce(new mocks.StackAlreadyExistsError("exists"));
        const program = await PulumiProgram.create(
            "test_stack",
            { logger: { info: (m) => infos.push(m), error: () => {} } },
            opttest.tempDir(tmpBase),
            opttest.testInPlace(),
            opttest.skipInstall(),
        );

        await program.cleanup();
        await program.cleanup(true);

        expect(mocks.stack.destroy).not.toHaveBeenCalled();
        expect(infos.some((m) => /existed before this run/.test(m))).toBe(true);
    });

    it("destroys a pre-existing stack when destroyExistingStack is given", async () => {
        mocks.LocalWorkspace.createStack.mockRejectedValueOnce(new mocks.StackAlreadyExistsError("exists"));
        const program = await quietProgram(
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.destroyExistingStack(),
        );

        await program.cleanup();

        expect(program.stackPreexisted).toBe(true);
        expect(mocks.stack.destroy).toHaveBeenCalledWith({ remove: true });
    });

    it("swallows destroy errors by default", async () => {
        const errors: string[] = [];
        const program = await PulumiProgram.create(
            "test_stack",
            { logger: { info: () => {}, error: (m) => errors.push(m) } },
            opttest.tempDir(tmpBase),
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
        // The backend lives next to the copy, so one cleanup removes both.
        expect(program.getEnvVars().PULUMI_BACKEND_URL).toBe(
            `file://${path.join(path.dirname(program.workingDir), "backend")}`,
        );
    });

    it("creates temp directories readable only by the current user", async () => {
        if (process.platform === "win32") return;
        const tempDir = path.join(sandbox, "tmp");
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.skipStackCreate(),
            opttest.tempDir(tempDir),
        );

        for (const dir of [tempDir, path.dirname(program.workingDir), program.workingDir]) {
            expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
        }
    });

    it("does not copy .git, .env files, or dependency and build directories", async () => {
        for (const dir of [".git", "node_modules", "bin", "obj", "__pycache__", ".venv"]) {
            fs.mkdirSync(path.join(source, dir), { recursive: true });
            fs.writeFileSync(path.join(source, dir, "x"), "x\n");
        }
        fs.writeFileSync(path.join(source, ".env"), "SECRET=1\n");
        fs.writeFileSync(path.join(source, ".env.local"), "SECRET=2\n");
        fs.writeFileSync(path.join(source, ".envrc"), "keep\n");

        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.skipStackCreate(),
            opttest.tempDir(path.join(sandbox, "tmp")),
        );

        for (const name of [
            ".git",
            "node_modules",
            "bin",
            "obj",
            "__pycache__",
            ".venv",
            ".env",
            ".env.local",
        ]) {
            expect(fs.existsSync(path.join(program.workingDir, name))).toBe(false);
        }
        expect(fs.existsSync(path.join(program.workingDir, ".envrc"))).toBe(true);
        expect(fs.existsSync(path.join(program.workingDir, "index.ts"))).toBe(true);
    });

    it("copies symlinks inside the program but skips ones that escape it", async () => {
        if (process.platform === "win32") return;
        fs.symlinkSync(path.join("nested", "file.txt"), path.join(source, "inside-link"));
        fs.symlinkSync(sandbox, path.join(source, "escape-dir"));
        fs.writeFileSync(path.join(sandbox, "outside.txt"), "outside\n");
        fs.symlinkSync(path.join("..", "outside.txt"), path.join(source, "escape-file"));

        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.skipStackCreate(),
            opttest.tempDir(path.join(sandbox, "tmp")),
        );

        expect(fs.lstatSync(path.join(program.workingDir, "inside-link")).isSymbolicLink()).toBe(true);
        expect(fs.existsSync(path.join(program.workingDir, "escape-dir"))).toBe(false);
        expect(fs.existsSync(path.join(program.workingDir, "escape-file"))).toBe(false);
    });

    it("does not recurse into its own temp directory when the source contains it", async () => {
        // Default temp base is ./tmp under cwd; simulate the program living in cwd.
        const tempDir = path.join(source, "tmp");
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.skipStackCreate(),
            opttest.tempDir(tempDir),
        );

        expect(fs.existsSync(path.join(program.workingDir, "tmp"))).toBe(false);
        expect(fs.existsSync(path.join(program.workingDir, "index.ts"))).toBe(true);
    });

    it("removes the temp directory and backend on cleanup", async () => {
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.tempDir(path.join(sandbox, "tmp")),
        );
        const programDir = path.dirname(program.workingDir);
        expect(fs.existsSync(programDir)).toBe(true);

        await program.cleanup();

        expect(mocks.stack.destroy).toHaveBeenCalledWith({ remove: true });
        expect(fs.existsSync(programDir)).toBe(false);
    });

    it("keeps the temp directory when the destroy fails or keepTempDir is given", async () => {
        const failing = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.tempDir(path.join(sandbox, "tmp")),
        );
        mocks.stack.destroy.mockRejectedValueOnce(new Error("destroy failed"));
        await failing.cleanup();
        expect(fs.existsSync(failing.workingDir)).toBe(true);

        const kept = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.skipInstall(),
            opttest.tempDir(path.join(sandbox, "tmp")),
            opttest.keepTempDir(),
        );
        await kept.cleanup();
        expect(fs.existsSync(kept.workingDir)).toBe(true);
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
        fs.writeFileSync(path.join(modified, ".env"), "SHOULD_NOT_COPY\n");

        program.updateSource(modified);

        const read = (p: string) => fs.readFileSync(path.join(program.workingDir, p), "utf8");
        expect(read("index.ts")).toBe("// v2\n");
        expect(read("extra.ts")).toBe("// extra\n");
        expect(read("Pulumi.yaml")).toBe("name: my_program\nruntime: nodejs\n");
        expect(read(path.join(".pulumi", "state"))).toBe("state\n");
        expect(fs.existsSync(path.join(program.workingDir, "Pulumi.test.yaml"))).toBe(false);
        expect(fs.existsSync(path.join(program.workingDir, ".env"))).toBe(false);
    });

    it("copyTo creates an in-place program in the target directory", async () => {
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.tempDir(path.join(sandbox, "tmp")),
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

    it("copyToTempDir copies own their directory and remove it on cleanup", async () => {
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
        const programDir = path.dirname(copy.workingDir);
        expect(fs.existsSync(programDir)).toBe(true);

        await copy.cleanup();

        expect(fs.existsSync(programDir)).toBe(false);
        expect(fs.existsSync(source)).toBe(true);
    });

    it("copyTo copies do not remove a caller-chosen directory on cleanup", async () => {
        const program = await PulumiProgram.create(
            source,
            { logger: silentLogger },
            opttest.tempDir(path.join(sandbox, "tmp")),
            opttest.testInPlace(),
            opttest.skipInstall(),
            opttest.skipStackCreate(),
        );

        const target = path.join(sandbox, "copy");
        const copy = await program.copyTo(target);
        await copy.cleanup();

        expect(fs.existsSync(path.join(target, "index.ts"))).toBe(true);
    });
});

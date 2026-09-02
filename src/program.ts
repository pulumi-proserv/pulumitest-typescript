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
 * Framework-independent Pulumi program wrapper.
 *
 * PulumiProgram wraps the Pulumi Automation API with ZERO test framework
 * dependencies. It can be used with vitest, jest, mocha, node:test, or
 * standalone.
 *
 * Example usage in vitest / jest:
 *
 *     let program: PulumiProgram;
 *     beforeAll(async () => { program = await PulumiProgram.create("test_stack"); });
 *     afterAll(() => program.cleanup());
 *
 *     it("deploys", async () => {
 *         const result = await program.up();
 *         expect(result.outputs).toHaveProperty("bucketName");
 *     });
 *
 * Example usage standalone:
 *
 *     const program = await PulumiProgram.create("test_stack");
 *     try {
 *         await program.up();
 *     } finally {
 *         await program.cleanup();
 *     }
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import * as auto from "@pulumi/pulumi/automation";

import * as opttest from "./opttest";
import { PreviewResult, RefreshResult, UpdateResult } from "./results";

/** Minimal logging interface. Compatible with `console`. */
export interface Logger {
    info(message: string): void;
    error(message: string): void;
}

/** Options for constructing a PulumiProgram from pre-built values. */
export interface PulumiProgramArgs {
    /** Pre-built options. When given, `opts` are applied on top of it. */
    options?: opttest.Options;
    /** Logger to use. Defaults to a console-backed logger. */
    logger?: Logger;
}

function copyDirectory(srcDir: string, dest: string, filter?: (src: string) => boolean): void {
    fs.cpSync(srcDir, dest, {
        recursive: true,
        force: true,
        verbatimSymlinks: true,
        filter,
    });
}

/** Names preserved in the working directory when the source is swapped out. */
const PRESERVED_PATHS = new Set([".pulumi", "Pulumi.yaml", "Pulumi.test.yaml"]);

/**
 * Framework-independent Pulumi program wrapper.
 *
 * Wraps Pulumi Automation API operations without any test framework
 * dependencies. Provides a cleanup method for registration with any test
 * framework or manual invocation.
 *
 * Use the async {@link PulumiProgram.create} factory to construct an instance;
 * the Node Automation API is asynchronous so initialization cannot happen in a
 * constructor.
 */
export class PulumiProgram {
    static readonly defaultStackName = "test";

    workingDir: string;
    options: opttest.Options;
    logger: Logger;
    currentStack: auto.Stack | undefined;
    localWorkspace: auto.LocalWorkspace | undefined;
    private envVars: Record<string, string>;

    private constructor(workingDir: string, options: opttest.Options, logger: Logger) {
        this.workingDir = workingDir;
        this.options = options;
        this.logger = logger;
        this.currentStack = undefined;
        this.localWorkspace = undefined;
        // Custom env vars from the env() option take precedence over defaults.
        this.envVars = {
            PULUMI_BACKEND_URL: process.env.PULUMI_BACKEND_URL ?? "",
            PULUMI_CONFIG_PASSPHRASE: this.options.configPassphrase || "correct horse battery staple",
            ...this.options.customEnv,
        };
    }

    /** Env vars to hand to the Automation API, with empty values dropped. */
    private workspaceEnvVars(): Record<string, string> | undefined {
        const entries = Object.entries(this.envVars).filter(([, v]) => v !== "");
        return entries.length > 0 ? Object.fromEntries(entries) : undefined;
    }

    /**
     * Create a PulumiProgram for the program in `workingDir`.
     *
     * Unless `opttest.testInPlace()` is given, the program is copied to a fresh
     * temporary directory first. Then a local workspace is created, `pulumi
     * install` is run (unless skipped) and the stack is created or selected
     * (unless skipped).
     */
    static async create(workingDir: string, ...opts: opttest.Option[]): Promise<PulumiProgram>;
    static async create(
        workingDir: string,
        args: PulumiProgramArgs,
        ...opts: opttest.Option[]
    ): Promise<PulumiProgram>;
    static async create(
        workingDir: string,
        ...rest: (PulumiProgramArgs | opttest.Option)[]
    ): Promise<PulumiProgram> {
        let args: PulumiProgramArgs = {};
        let opts: opttest.Option[];
        if (rest.length > 0 && typeof rest[0] !== "function") {
            args = rest[0];
            opts = rest.slice(1) as opttest.Option[];
        } else {
            opts = rest as opttest.Option[];
        }

        const options = args.options ?? opttest.defaultOptions();
        opttest.applyOptions(options, opts);
        const logger = args.logger ?? createDefaultLogger();

        const program = new PulumiProgram(workingDir, options, logger);

        if (!program.options.testInPlace) {
            const destination = program.createTempDir();
            program.copyToInternal(destination);
            program.workingDir = destination;
        }

        await program.initStack();
        return program;
    }

    private createTempDir(): string {
        let baseDir: string;
        if (this.options.tempDir) {
            baseDir = this.options.tempDir;
        } else {
            baseDir = path.join(process.cwd(), "tmp");
        }
        fs.mkdirSync(baseDir, { recursive: true });

        const tempPath = path.join(baseDir, `programDir_${randomUUID().replace(/-/g, "").slice(0, 8)}`);
        this.logger.info(`Creating temp directory ${path.basename(tempPath)}`);

        const sourceBase = path.basename(path.resolve(this.workingDir));
        const destination = path.join(tempPath, sourceBase);
        fs.mkdirSync(destination, { recursive: true, mode: 0o755 });
        return destination;
    }

    private copyToInternal(directory: string): void {
        try {
            copyDirectory(this.workingDir, directory);
        } catch (e) {
            throw new Error(`Error copying program to ${directory}: ${errorMessage(e)}`, { cause: e });
        }
    }

    private async initStack(): Promise<void> {
        this.logger.info("Creating local workspace...");
        const envVars = this.workspaceEnvVars();
        this.localWorkspace = await auto.LocalWorkspace.create({ workDir: this.workingDir, envVars });

        if (!this.options.skipInstall) {
            this.logger.info("Running pulumi install...");
            await this.localWorkspace.install();
        }

        if (!this.options.skipStackCreate) {
            const stackName = this.options.stackName || PulumiProgram.defaultStackName;
            this.logger.info(`Running pulumi stack init... (stack: ${stackName})`);
            this.currentStack = await auto.LocalWorkspace.createOrSelectStack(
                { stackName, workDir: this.workingDir },
                { envVars },
            );
        } else {
            this.logger.info("Skipping stack creation (skipStackCreate=true)");
        }
    }

    /**
     * Destroy and remove the stack. Register with your test framework's
     * teardown hook.
     *
     * @param raiseOnError Re-throw if the destroy fails. Defaults to false to
     *   preserve existing behaviour, but a failed destroy leaves real cloud
     *   resources behind, so suites that care about leaks should pass true
     *   and let the teardown fail loudly.
     */
    async cleanup(raiseOnError = false): Promise<void> {
        if (this.currentStack === undefined) {
            this.logger.info("No current stack, skipping destroy...");
            return;
        }

        this.logger.info("Running pulumi destroy and removing stack...");
        try {
            await this.currentStack.destroy({ remove: true });
        } catch (e) {
            this.logger.error(
                `Destroy failed for stack '${this.currentStack.name}'; ` +
                    `cloud resources may have been left behind\n${errorStack(e)}`,
            );
            if (raiseOnError) {
                throw e;
            }
        }
    }

    /** Run `pulumi up`. */
    async up(): Promise<UpdateResult> {
        const stack = this.requireStack();
        this.logger.info(`Running pulumi up on stack: ${stack.name}`);
        return new UpdateResult(await stack.up());
    }

    /** Run `pulumi preview`. */
    async preview(): Promise<PreviewResult> {
        const stack = this.requireStack();
        this.logger.info(`Running pulumi preview on stack: ${stack.name}`);
        return new PreviewResult(await stack.preview());
    }

    /** Run `pulumi refresh`. */
    async refresh(): Promise<RefreshResult> {
        const stack = this.requireStack();
        this.logger.info(`Running pulumi refresh on stack: ${stack.name}`);
        return new RefreshResult(await stack.refresh());
    }

    /** Run `pulumi destroy`. */
    async destroy(): Promise<auto.DestroyResult> {
        const stack = this.requireStack();
        this.logger.info(`Running pulumi destroy on stack: ${stack.name}`);
        return stack.destroy();
    }

    /**
     * Update the working directory from `sourceDir`, preserving stack state.
     *
     * Top-level `.pulumi`, `Pulumi.yaml` and `Pulumi.test.yaml` entries in the
     * source are not copied so the existing project and stack remain intact.
     */
    updateSource(sourceDir: string): void {
        this.logger.info(`Updating source from ${sourceDir} to ${this.workingDir}`);
        const sourceRoot = path.resolve(sourceDir);
        try {
            copyDirectory(sourceRoot, this.workingDir, (src) => {
                const resolved = path.resolve(src);
                const isTopLevel = path.dirname(resolved) === sourceRoot;
                return !(isTopLevel && PRESERVED_PATHS.has(path.basename(resolved)));
            });
        } catch (e) {
            throw new Error(`Error updating source from ${sourceDir}: ${errorMessage(e)}`, { cause: e });
        }
    }

    /** Add ESC environments to the stack. */
    async addEnvironments(...environmentNames: string[]): Promise<void> {
        const stack = this.requireStack();
        await stack.addEnvironments(...environmentNames);
    }

    /** Get the environment variables for this workspace. */
    getEnvVars(): Record<string, string> {
        return { ...this.envVars };
    }

    /** Copy the program to a new temporary directory. */
    async copyToTempDir(...opts: opttest.Option[]): Promise<PulumiProgram> {
        const destination = this.createTempDir();
        return this.copyTo(destination, ...opts);
    }

    /** Copy the program to the specified directory. */
    async copyTo(directory: string, ...opts: opttest.Option[]): Promise<PulumiProgram> {
        this.copyToInternal(directory);
        const options = opttest.copyOptions(this.options);
        opttest.applyOptions(options, opts);
        opttest.testInPlace()(options);
        return PulumiProgram.create(directory, { options, logger: this.logger });
    }

    private requireStack(): auto.Stack {
        if (this.currentStack === undefined) {
            throw new Error("Stack not initialized");
        }
        return this.currentStack;
    }
}

let loggerCounter = 0;

function createDefaultLogger(): Logger {
    const name = `PulumiProgram-${++loggerCounter}`;
    return {
        info: (message) => console.log(`INFO - ${name} - ${message}`),
        error: (message) => console.error(`ERROR - ${name} - ${message}`),
    };
}

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function errorStack(e: unknown): string {
    return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

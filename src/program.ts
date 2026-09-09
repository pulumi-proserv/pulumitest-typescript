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
import { pathToFileURL } from "node:url";
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

/**
 * Directory and file names never copied from the program under test.
 *
 * These hold credentials (`.env*`), history that may contain old secrets
 * (`.git`), or build output that is large and reproducible.
 */
export const EXCLUDED_NAMES: ReadonlySet<string> = new Set([
    ".git",
    ".env",
    "node_modules",
    "bin",
    "obj",
    "__pycache__",
    ".venv",
    "venv",
    ".terraform",
]);

function isExcludedName(name: string): boolean {
    return EXCLUDED_NAMES.has(name) || name.startsWith(".env.");
}

function shortId(): string {
    return randomUUID().replace(/-/g, "").slice(0, 8);
}

/**
 * Build a copy filter that skips excluded names, refuses symlinks whose target
 * lies outside `sourceRoot`, and never descends into `avoid` (typically the
 * destination, so copying a directory into its own subtree cannot recurse).
 */
function safeCopyFilter(sourceRoot: string, avoid: string[], extra?: (resolved: string) => boolean) {
    const root = path.resolve(sourceRoot);
    const avoidResolved = avoid.map((a) => path.resolve(a));
    return (src: string): boolean => {
        const resolved = path.resolve(src);
        if (resolved === root) return true;
        if (avoidResolved.some((a) => resolved === a || resolved.startsWith(a + path.sep))) return false;
        if (isExcludedName(path.basename(resolved))) return false;
        if (fs.lstatSync(resolved).isSymbolicLink()) {
            const target = path.resolve(path.dirname(resolved), fs.readlinkSync(resolved));
            if (target !== root && !target.startsWith(root + path.sep)) return false;
        }
        return extra ? extra(resolved) : true;
    };
}

/**
 * Recursive copy that consults `filter` for every entry before touching it.
 * Symlinks are recreated verbatim, files overwrite, directories are created
 * private to the current user. `fs.cpSync` is not used because it rejects
 * copying a directory into its own subtree even when the filter excludes the
 * destination, which is the common case of testing from the project root
 * with the default `./tmp`.
 */
function copyDirectory(srcDir: string, dest: string, filter: (src: string) => boolean): void {
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const from = path.join(srcDir, entry.name);
        if (!filter(from)) continue;
        const to = path.join(dest, entry.name);
        if (entry.isSymbolicLink()) {
            fs.rmSync(to, { force: true, recursive: true });
            fs.symlinkSync(fs.readlinkSync(from), to);
        } else if (entry.isDirectory()) {
            copyDirectory(from, to, filter);
        } else {
            fs.copyFileSync(from, to);
        }
    }
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
    /**
     * True when the stack already existed and was selected rather than
     * created. `cleanup()` refuses to destroy such a stack unless
     * `opttest.destroyExistingStack()` was given.
     */
    stackPreexisted = false;
    /** Directory this program created and will remove in `cleanup()`, if any. */
    private ownedTempDir: string | undefined;
    /** Local file backend directory created for this program, if any. */
    private backendDir: string | undefined;
    private envVars: Record<string, string>;

    private constructor(workingDir: string, options: opttest.Options, logger: Logger) {
        this.workingDir = workingDir;
        this.options = options;
        this.logger = logger;
        this.currentStack = undefined;
        this.localWorkspace = undefined;
        this.envVars = {
            PULUMI_CONFIG_PASSPHRASE: this.options.configPassphrase || opttest.DEFAULT_CONFIG_PASSPHRASE,
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
            const { programDir, destination } = program.createTempDir();
            program.ownedTempDir = programDir;
            program.copyToInternal(destination);
            program.workingDir = destination;
        }

        program.configureBackend();
        await program.initStack();
        return program;
    }

    private tempBase(): string {
        return this.options.tempDir ? this.options.tempDir : path.join(process.cwd(), "tmp");
    }

    /**
     * Create `<tempBase>/programDir_<id>/<program name>`.
     *
     * Directories are private to the current user (`0700`) because the copy may
     * include stack config and state.
     */
    private createTempDir(): { programDir: string; destination: string } {
        const baseDir = this.tempBase();
        fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });

        const programDir = path.join(baseDir, `programDir_${shortId()}`);
        this.logger.info(`Creating temp directory ${path.basename(programDir)}`);

        const sourceBase = path.basename(path.resolve(this.workingDir));
        const destination = path.join(programDir, sourceBase);
        fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
        return { programDir, destination };
    }

    /**
     * Pick the backend. Precedence: an explicit `env("PULUMI_BACKEND_URL", ...)`,
     * then the ambient backend if `useAmbientBackend()` was given, otherwise a
     * private local file backend so test stacks never reach a shared backend.
     */
    private configureBackend(): void {
        if (this.options.customEnv.PULUMI_BACKEND_URL === undefined && !this.options.useAmbientBackend) {
            const backendDir = this.ownedTempDir
                ? path.join(this.ownedTempDir, "backend")
                : path.join(this.tempBase(), `backend_${shortId()}`);
            fs.mkdirSync(backendDir, { recursive: true, mode: 0o700 });
            this.backendDir = backendDir;
            this.envVars.PULUMI_BACKEND_URL = pathToFileURL(backendDir).href;
        }
        // Custom env vars from the env() option take precedence over defaults.
        Object.assign(this.envVars, this.options.customEnv);
    }

    private copyToInternal(directory: string): void {
        try {
            copyDirectory(
                this.workingDir,
                directory,
                safeCopyFilter(this.workingDir, [directory, this.tempBase()]),
            );
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

        if (this.options.skipStackCreate) {
            this.logger.info("Skipping stack creation (skipStackCreate=true)");
            return;
        }

        const stackName = this.options.stackName || PulumiProgram.defaultStackName;
        const args = { stackName, workDir: this.workingDir };
        this.logger.info(`Running pulumi stack init... (stack: ${stackName})`);
        try {
            this.currentStack = await auto.LocalWorkspace.createStack(args, { envVars });
        } catch (e) {
            if (!(e instanceof auto.StackAlreadyExistsError)) {
                throw e;
            }
            this.currentStack = await auto.LocalWorkspace.selectStack(args, { envVars });
            this.stackPreexisted = true;
            this.logger.info(
                `Stack '${stackName}' already existed and was selected, not created. ` +
                    (this.options.destroyExistingStack
                        ? "cleanup() will destroy it because destroyExistingStack() was given."
                        : "cleanup() will leave it in place; pass opttest.destroyExistingStack() to destroy it."),
            );
        }
    }

    /**
     * Destroy and remove the stack, then delete the temporary copy of the
     * program. Register with your test framework's teardown hook.
     *
     * A stack that existed before this run is left untouched unless
     * `opttest.destroyExistingStack()` was given. The temporary directory is
     * kept when the destroy fails, so the state is available for inspection,
     * or when `opttest.keepTempDir()` was given.
     *
     * @param raiseOnError Re-throw if the destroy fails. Defaults to false to
     *   preserve existing behaviour, but a failed destroy leaves real cloud
     *   resources behind, so suites that care about leaks should pass true
     *   and let the teardown fail loudly.
     */
    async cleanup(raiseOnError = false): Promise<void> {
        if (this.currentStack === undefined) {
            this.logger.info("No current stack, skipping destroy...");
            this.removeTempDirs();
            return;
        }

        if (this.stackPreexisted && !this.options.destroyExistingStack) {
            this.logger.info(
                `Stack '${this.currentStack.name}' existed before this run; leaving it in place. ` +
                    "Pass opttest.destroyExistingStack() to destroy it.",
            );
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
            return;
        }
        this.removeTempDirs();
    }

    private removeTempDirs(): void {
        if (this.options.keepTempDir) {
            return;
        }
        for (const dir of [this.ownedTempDir, this.backendDir]) {
            if (dir !== undefined && fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
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
            copyDirectory(
                sourceRoot,
                this.workingDir,
                safeCopyFilter(sourceRoot, [this.workingDir], (resolved) => {
                    const isTopLevel = path.dirname(resolved) === sourceRoot;
                    return !(isTopLevel && PRESERVED_PATHS.has(path.basename(resolved)));
                }),
            );
        } catch (e) {
            throw new Error(`Error updating source from ${sourceDir}: ${errorMessage(e)}`, { cause: e });
        }
    }

    /** Add ESC environments to the stack. */
    async addEnvironments(...environmentNames: string[]): Promise<void> {
        const stack = this.requireStack();
        await stack.addEnvironments(...environmentNames);
    }

    /**
     * Get the environment variables for this workspace.
     *
     * Includes the config passphrase and anything passed via `opttest.env()`,
     * which may be credentials. Do not log the returned object.
     */
    getEnvVars(): Record<string, string> {
        return { ...this.envVars };
    }

    /** Copy the program to a new temporary directory. */
    async copyToTempDir(...opts: opttest.Option[]): Promise<PulumiProgram> {
        const { destination } = this.createTempDir();
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

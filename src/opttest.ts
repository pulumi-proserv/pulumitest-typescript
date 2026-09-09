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
 * Test options for the Pulumi testing framework.
 *
 * Matches the Go providertest/opttest naming convention. Options control
 * how PulumiProgram initializes and runs Pulumi programs.
 */

/** The fixed, publicly known passphrase used when none is supplied. */
export const DEFAULT_CONFIG_PASSPHRASE = "correct horse battery staple";

/** Configuration options for Pulumi testing. */
export interface Options {
    stackName: string;
    skipInstall: boolean;
    skipStackCreate: boolean;
    testInPlace: boolean;
    tempDir: string;
    configPassphrase: string;
    useAmbientBackend: boolean;
    customEnv: Record<string, string>;
    /** Allow `cleanup()` to destroy a stack that existed before this run. */
    destroyExistingStack: boolean;
    /** Leave the temporary copy of the program on disk after `cleanup()`. */
    keepTempDir: boolean;
}

/** An option is a function that mutates an Options instance. */
export type Option = (options: Options) => void;

/** Create a new Options instance with default values. */
export function defaultOptions(): Options {
    return {
        stackName: "test",
        skipInstall: false,
        skipStackCreate: false,
        testInPlace: false,
        tempDir: process.env.PULUMITEST_TEMP_DIR ?? "",
        configPassphrase: DEFAULT_CONFIG_PASSPHRASE,
        useAmbientBackend: false,
        customEnv: {},
        destroyExistingStack: false,
        keepTempDir: false,
    };
}

/** Create a deep copy of the given options. */
export function copyOptions(options: Options): Options {
    return { ...options, customEnv: { ...options.customEnv } };
}

/** Apply a list of options to an Options instance, in order. */
export function applyOptions(options: Options, opts: Option[]): Options {
    for (const opt of opts) {
        opt(options);
    }
    return options;
}

/** Set the stack name to use when running the program under test. */
export function stackName(name: string): Option {
    return (o) => {
        o.stackName = name;
    };
}

/** Skip running `pulumi install` before running the program under test. */
export function skipInstall(): Option {
    return (o) => {
        o.skipInstall = true;
    };
}

/** Skip creating the stack before running the program under test. */
export function skipStackCreate(): Option {
    return (o) => {
        o.skipStackCreate = true;
    };
}

/**
 * Run the program from its current location, rather than copying to a temporary directory.
 *
 * The program's real directory is used, so `up`, `destroy` and `cleanup()` act
 * on whatever stack the name resolves to there. A stack that already existed
 * before the run is never destroyed by `cleanup()` unless
 * {@link destroyExistingStack} is also given.
 */
export function testInPlace(): Option {
    return (o) => {
        o.testInPlace = true;
    };
}

/** Set the temporary directory for copying the program under test. */
export function tempDir(directory: string): Option {
    return (o) => {
        o.tempDir = directory;
    };
}

/**
 * Set the config passphrase to use when running the program under test.
 *
 * The default is the fixed, publicly known string
 * {@link DEFAULT_CONFIG_PASSPHRASE}. Stack config secrets encrypted with it
 * are not protected. Pass a real value if the test stack's config will hold
 * anything sensitive.
 */
export function configPassphrase(passphrase: string): Option {
    return (o) => {
        o.configPassphrase = passphrase;
    };
}

/**
 * Use whatever backend `pulumi login` or `PULUMI_BACKEND_URL` points at.
 *
 * By default each program gets its own local file backend under the temp
 * directory, so test stacks never touch a shared backend. Pass this option
 * when the test needs a real backend, for example to attach ESC environments
 * or use Pulumi Cloud secrets providers.
 */
export function useAmbientBackend(): Option {
    return (o) => {
        o.useAmbientBackend = true;
    };
}

/**
 * Set a custom environment variable to use when running the program under test.
 *
 * Values are handed to the Pulumi CLI as-is and returned by
 * `PulumiProgram.getEnvVars()`. Treat anything passed here as a secret that
 * must not be logged.
 */
export function env(key: string, value: string): Option {
    return (o) => {
        o.customEnv[key] = value;
    };
}

/**
 * Allow `cleanup()` to destroy and remove a stack that already existed before
 * this run selected it. Without this option a pre-existing stack is left
 * untouched, because destroying it would remove infrastructure the test did
 * not create.
 */
export function destroyExistingStack(): Option {
    return (o) => {
        o.destroyExistingStack = true;
    };
}

/** Keep the temporary copy of the program on disk after `cleanup()`, for inspection. */
export function keepTempDir(): Option {
    return (o) => {
        o.keepTempDir = true;
    };
}

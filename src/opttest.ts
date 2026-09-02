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
        configPassphrase: "correct horse battery staple",
        useAmbientBackend: false,
        customEnv: {},
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

/** Run the program from its current location, rather than copying to a temporary directory. */
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

/** Set the config passphrase to use when running the program under test. */
export function configPassphrase(passphrase: string): Option {
    return (o) => {
        o.configPassphrase = passphrase;
    };
}

/** Use whatever backend configuration has been set via `pulumi login` or PULUMI_BACKEND_URL. */
export function useAmbientBackend(): Option {
    return (o) => {
        o.useAmbientBackend = true;
    };
}

/** Set a custom environment variable to use when running the program under test. */
export function env(key: string, value: string): Option {
    return (o) => {
        o.customEnv[key] = value;
    };
}

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- `cleanup()` no longer destroys a stack that existed before the run. Such a stack is selected, `stackPreexisted` is set, and destroy is skipped unless `opttest.destroyExistingStack()` is given
- Each program now uses a private local file backend by default; `opttest.useAmbientBackend()` opts into the `pulumi login` backend as the option always documented
- The temporary copy of the program excludes `.git`, `.env*`, `node_modules`, `bin`, `obj`, `__pycache__`, `.venv`, `venv`, and `.terraform`, skips symlinks that escape the program directory, is created with mode `0700`, and is deleted by `cleanup()` (`opttest.keepTempDir()` keeps it)
- Documented that the default config passphrase is public and that `getEnvVars()` returns secrets
- Added `SECURITY.md` and Dependabot configuration

### Added

- `PulumiProgram` API for testing Pulumi programs using the Automation API, ported from [pulumitest-python](https://github.com/pulumi-labs/pulumitest-python)
- Framework-agnostic design: works with vitest, jest, mocha, `node:test`, or standalone scripts
- Configuration options via `opttest` module (`testInPlace`, `skipInstall`, `stackName`, `configPassphrase`, etc.)
- Result assertion methods: `hasNoChanges`, `hasNoDeletes`, `hasNoReplacements`
- Result types: `UpdateResult`, `PreviewResult`, `RefreshResult` with access to outputs, summaries, and change summaries
- `updateSource` for drift testing (swap program files while maintaining the same stack)
- `copyToTempDir` for isolated test copies
- `cleanup(raiseOnError)` to optionally surface destroy failures
- Apply `env()` custom environment variables to the Automation API workspace and stack, so options like `PULUMI_BACKEND_URL` take effect
- Direct access to Pulumi Automation API via `currentStack` and `localWorkspace` properties
- CI pipeline with lint and test matrix (Node.js 20, 22, 24)
- Tag-triggered release pipeline publishing an npm tarball to GitHub Releases

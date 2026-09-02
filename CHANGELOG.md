# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `PulumiProgram` API for testing Pulumi programs using the Automation API, ported from [pulumitest-python](https://github.com/pulumi-labs/pulumitest-python)
- Framework-agnostic design: works with vitest, jest, mocha, `node:test`, or standalone scripts
- Configuration options via `opttest` module (`testInPlace`, `skipInstall`, `stackName`, `configPassphrase`, etc.)
- Result assertion methods: `hasNoChanges`, `hasNoDeletes`, `hasNoReplacements`
- Result types: `UpdateResult`, `PreviewResult`, `RefreshResult` with access to outputs, summaries, and change summaries
- `updateSource` for drift testing (swap program files while maintaining the same stack)
- `copyToTempDir` for isolated test copies
- `cleanup(raiseOnError)` to optionally surface destroy failures
- Direct access to Pulumi Automation API via `currentStack` and `localWorkspace` properties
- CI pipeline with lint and test matrix (Node.js 20, 22, 24)
- Tag-triggered release pipeline publishing an npm tarball to GitHub Releases

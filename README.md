# Pulumitest TypeScript

A TypeScript port of [pulumitest](https://github.com/pulumi/pulumitest) (Go) for testing Pulumi programs using the Automation API. Framework-agnostic: works with vitest, jest, mocha, `node:test`, or standalone.

A sibling [Python port](https://github.com/pulumi-labs/pulumitest-python) exists with the same API surface.

## Installation

The package is not published to npm yet. Install it from the GitHub repository:

```bash
npm install --save-dev github:pulumi-proserv/pulumitest-typescript
```

Pin to a tag or commit for reproducible installs, for example
`github:pulumi-proserv/pulumitest-typescript#v0.1.0`. npm runs the package's
`prepare` script on install, so the TypeScript is compiled on your machine and
no prebuilt `dist/` is needed.

The repository is internal, so the install needs a Git credential with access
to the `pulumi-proserv` organization. Over SSH, use the explicit form:

```bash
npm install --save-dev git+ssh://git@github.com/pulumi-proserv/pulumitest-typescript.git#v0.1.0
```

## Quick Start

The Node Automation API is asynchronous, so a program is created with the async `PulumiProgram.create()` factory and every operation returns a Promise.

### Vitest / Jest

```typescript
import { PulumiProgram, opttest } from "pulumitest";

describe("my stack", () => {
  let program: PulumiProgram;

  beforeAll(async () => {
    program = await PulumiProgram.create("my-pulumi-project");
    await program.addEnvironments("my-org/aws-dev");
  });

  afterAll(() => program.cleanup());

  it("deploys", async () => {
    const result = await program.up();
    expect(result.outputs).toHaveProperty("bucketName");

    const preview = await program.preview();
    preview.hasNoChanges();
  });
});
```

### node:test

```typescript
import { test } from "node:test";
import { PulumiProgram } from "pulumitest";

test("deployment", async (t) => {
  const program = await PulumiProgram.create("my-pulumi-project");
  t.after(() => program.cleanup());

  await program.addEnvironments("my-org/aws-dev");
  await program.up();
});
```

### Standalone

```typescript
import { PulumiProgram } from "pulumitest";

const program = await PulumiProgram.create("my-pulumi-project");
try {
  const result = await program.up();
  console.log("Outputs:", result.outputs);
} finally {
  await program.cleanup();
}
```

## Configuration Options

```typescript
const program = await PulumiProgram.create(
  "my-pulumi-project",
  opttest.testInPlace(), // Don't copy to temp directory
  opttest.skipInstall(), // Skip pulumi install
  opttest.stackName("dev"), // Custom stack name
  opttest.configPassphrase("x"), // Set config passphrase
);
```

| Option                   | Description                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| Option                   | Description                                                      |
| ------------------------ | ---------------------------------------------------------------- |
| `testInPlace()`          | Run from source directory (no copy)                              |
| `skipInstall()`          | Skip `pulumi install`                                            |
| `skipStackCreate()`      | Skip stack creation (must exist)                                 |
| `stackName(name)`        | Set custom stack name                                            |
| `configPassphrase(p)`    | Set config passphrase                                            |
| `tempDir(path)`          | Set custom temp directory                                        |
| `useAmbientBackend()`    | Use existing `pulumi login` backend instead of a private one     |
| `env(key, value)`        | Set custom environment variable                                  |
| `destroyExistingStack()` | Let `cleanup()` destroy a stack that existed before the run      |
| `keepTempDir()`          | Leave the temporary copy on disk after `cleanup()`               |

The temp directory defaults to `./tmp` under the current working directory, or `$PULUMITEST_TEMP_DIR` when set. Temp directories are created readable only by the current user and are deleted by `cleanup()`.

### Isolation defaults

- **Backend.** Each program gets a private local file backend under its temp directory, so test stacks never reach the backend `pulumi login` points at. Pass `useAmbientBackend()` when a test needs Pulumi Cloud, for example to attach ESC environments, or set `env("PULUMI_BACKEND_URL", ...)` explicitly.
- **Pre-existing stacks.** If the stack name already exists, it is selected rather than created and `program.stackPreexisted` is `true`. `cleanup()` will not destroy it unless `destroyExistingStack()` was given. This matters with `testInPlace()`, where the default stack name `test` may collide with a real stack in the project directory.
- **Copied files.** `.git`, `.env` and `.env.*`, `node_modules`, `bin`, `obj`, `__pycache__`, `.venv`, `venv`, and `.terraform` are never copied, and symlinks that point outside the program directory are skipped.
- **Passphrase.** The default config passphrase is the fixed, publicly known string `correct horse battery staple`. Secrets in a test stack's config are not protected by it. Pass `configPassphrase()` with a real value if that matters.
- **`getEnvVars()`** returns the passphrase and anything passed via `env()`. Do not log it.

Environment variables from `env()` are passed to the Automation API workspace and take precedence over the defaults, so `env("PULUMI_BACKEND_URL", "file:///tmp/backend")` runs the stack against a local file backend instead of the ambient one.

A custom logger can be supplied through an args object as the second parameter:

```typescript
const program = await PulumiProgram.create("my-pulumi-project", { logger: console }, opttest.skipInstall());
```

## Result Assertions

```typescript
const result = await program.up();
result.hasNoChanges();
result.hasNoDeletes();
result.hasNoReplacements();

const preview = await program.preview();
preview.hasNoChanges();

const refresh = await program.refresh();
refresh.hasNoChanges();
```

All assertion methods throw a Node `AssertionError` on failure, which every test framework reports as a test failure.

## Result Properties

```typescript
// UpdateResult
const result = await program.up();
result.outputs; // OutputMap
result.summary; // UpdateSummary
result.changeSummary; // OpMap (OpType -> count)

// PreviewResult
const preview = await program.preview();
preview.changeSummary; // OpMap

// RefreshResult
const refresh = await program.refresh();
refresh.summary; // UpdateSummary
refresh.changeSummary; // OpMap
```

## Cleanup

`cleanup()` destroys the stack, removes it, and deletes the temporary copy of the program. A stack that existed before the run is left in place unless `destroyExistingStack()` was given. The temporary directory is kept when the destroy fails so state can be inspected. By default a failed destroy is logged but not thrown, so teardown never masks the test result. Pass `true` to make a failed destroy fail the teardown instead, which is useful in suites that must not leak cloud resources:

```typescript
afterAll(() => program.cleanup(true));
```

## Advanced Usage

### Update Source (Drift Testing)

Swap program files while maintaining the same stack. Top-level `Pulumi.yaml`, `Pulumi.test.yaml` and `.pulumi` entries are preserved:

```typescript
const program = await PulumiProgram.create("example");
afterAll(() => program.cleanup());

await program.up();
program.updateSource("path/to/modified");
const preview = await program.preview();
// preview will show changes
```

### Copy to Temp Directory

```typescript
const program = await PulumiProgram.create("example", opttest.testInPlace());
const copy = await program.copyToTempDir();
afterAll(() => copy.cleanup());
await copy.up();
```

### Access Pulumi Automation API

```typescript
const program = await PulumiProgram.create("example");
const stack = program.currentStack; // auto.Stack
const workspace = program.localWorkspace; // auto.LocalWorkspace
```

## Development

```bash
git clone https://github.com/pulumi-proserv/pulumitest-typescript.git
cd pulumitest-typescript
just install # npm ci
just test    # run tests
just lint    # typecheck + eslint + prettier
just build   # compile to dist/
```

## License

Apache 2.0

# Pulumitest TypeScript

A TypeScript port of [pulumitest](https://github.com/pulumi/pulumitest) (Go) for testing Pulumi programs using the Automation API. Framework-agnostic: works with vitest, jest, mocha, `node:test`, or standalone.

A sibling [Python port](https://github.com/pulumi-labs/pulumitest-python) exists with the same API surface.

## Installation

```bash
npm install --save-dev pulumitest
```

Or from source:

```bash
npm install --save-dev github:pulumi-proserv/pulumitest-typescript
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
    await program.addEnvironments("aws/pulumi-ce");
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

  await program.addEnvironments("aws/pulumi-ce");
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

| Option                | Description                         |
| --------------------- | ----------------------------------- |
| `testInPlace()`       | Run from source directory (no copy) |
| `skipInstall()`       | Skip `pulumi install`               |
| `skipStackCreate()`   | Skip stack creation (must exist)    |
| `stackName(name)`     | Set custom stack name               |
| `configPassphrase(p)` | Set config passphrase               |
| `tempDir(path)`       | Set custom temp directory           |
| `useAmbientBackend()` | Use existing `pulumi login` backend |
| `env(key, value)`     | Set custom environment variable     |

The temp directory defaults to `./tmp` under the current working directory, or `$PULUMITEST_TEMP_DIR` when set.

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

`cleanup()` destroys the stack and removes it. By default a failed destroy is logged but not thrown, so teardown never masks the test result. Pass `true` to make a failed destroy fail the teardown instead, which is useful in suites that must not leak cloud resources:

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

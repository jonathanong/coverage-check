# coverage-check

Patch-coverage gate for CI: checks that newly added lines meet per-path coverage thresholds using LCOV reports and `git diff`. Supports per-suite LCOV accumulation for conditional CI pipelines.

## Install

```sh
npm install coverage-check
```

## Usage

### Basic (single run)

```sh
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --base origin/main \
  --head HEAD
```

Exits `0` on pass, `1` on failure, `2` on configuration error.

### Suite store with S3 (conditional CI)

When only some CI suites run per PR (e.g. backend tests only when backend files change), store each suite's LCOV in S3 and merge them during coverage checks:

```sh
# After backend tests run on the main branch — store this suite's coverage
coverage-check store-put \
  --suite backend \
  --store-s3 my-bucket/coverage-store \
  --artifacts ./coverage-artifacts \
  --sha "$GITHUB_SHA" \
  --branch main

# On a PR that only runs frontend tests:
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --store-s3 my-bucket/coverage-store \
  --suite frontend \
  --branch main \
  --base origin/main \
  --head HEAD
```

The `--suite` flag on `check` tells the tool to use fresh `--artifacts` for the current suite and pull historical coverage from the store for all other suites. The `--branch` flag selects which branch pointer to follow when reading from the store.

**S3 key layout:**

```
<prefix>/<suite>/sha/<sha>/lcov.info          # payload
<prefix>/<suite>/branch/<branch>/latest.json  # pointer: { "sha": "...", "timestamp": "..." }
```

### Suite store with filesystem

For local development or simpler deployments:

```sh
coverage-check store-put \
  --suite backend \
  --store-fs ./coverage-store \
  --artifacts ./coverage-artifacts \
  --sha "$GITHUB_SHA" \
  --branch main

coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --store-fs ./coverage-store \
  --suite frontend \
  --base origin/main \
  --head HEAD
```

### GitHub PR sticky comment

Pass `--pr` and `--repo` to post (or update) a sticky comment on a pull request. Requires the `gh` CLI and `GH_TOKEN`/`GITHUB_TOKEN`.

On **failure**, the comment is created or updated with the list of uncovered lines. On **pass**, any existing failure comment is **deleted** — no new comment is posted.

```sh
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --pr "${{ github.event.pull_request.number }}" \
  --repo "${{ github.repository }}"
```

### GitHub Actions step summary

When `$GITHUB_STEP_SUMMARY` is set, a per-suite totals and per-rule patch-coverage table is appended to the job summary automatically.

## Rules file

```yaml
# .coverage-rules.yml
rules:
  - paths: backend/**
    patch_coverage_min: 90
  - paths: web/lib/api/**
    patch_coverage_min: 100
  - paths: web/**
    patch_coverage_min: 5
```

Rules are matched in order; the first match wins. Files in the diff not matched by any rule are reported as informational (not gated).

## CLI reference

### `coverage-check check`

| Flag             | Default                        | Description                                                                  |
| ---------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `--rules`        | `.coverage-rules.yml`          | Path to YAML rules file                                                      |
| `--artifacts`    | `./coverage-artifacts`         | Directory to scan for `lcov.info` files                                      |
| `--base`         | `origin/main`                  | Base git ref for `git diff`                                                  |
| `--head`         | `HEAD`                         | Head git ref for `git diff`                                                  |
| `--store-fs`     | —                              | Path to a filesystem suite store directory                                   |
| `--store`        | —                              | Alias for `--store-fs`                                                       |
| `--store-s3`     | —                              | S3 suite store spec: `<bucket>[/<prefix>]`                                   |
| `--branch`       | `$GITHUB_REF_NAME` or `"main"` | Branch pointer to follow when reading from the store                         |
| `--suite`        | —                              | Name of the current suite (fresh artifacts override this suite in the store) |
| `--strip-prefix` | —                              | Extra path prefix to strip from LCOV `SF:` lines (repeatable)                |
| `--pr`           | —                              | Pull request number for sticky comment                                       |
| `--repo`         | `$GITHUB_REPOSITORY`           | `owner/repo` for sticky comment                                              |
| `--json`         | —                              | Write JSON result to this path                                               |

### `coverage-check store-put`

| Flag             | Default                | Description                                                   |
| ---------------- | ---------------------- | ------------------------------------------------------------- |
| `--suite`        | required               | Suite name to store                                           |
| `--store-fs`     | required\*             | Path to a filesystem suite store directory                    |
| `--store`        | —                      | Alias for `--store-fs`                                        |
| `--store-s3`     | required\*             | S3 suite store spec: `<bucket>[/<prefix>]`                    |
| `--sha`          | required               | Git SHA to associate with this coverage payload               |
| `--branch`       | required               | Branch name for the pointer (e.g. `main`)                     |
| `--artifacts`    | `./coverage-artifacts` | Directory to scan for `lcov.info` files                       |
| `--strip-prefix` | —                      | Extra path prefix to strip from LCOV `SF:` lines (repeatable) |

\* Exactly one of `--store-fs` or `--store-s3` is required.

## Programmatic API

```ts
import { runCheck, runStorePut, FileSystemSuiteStore, S3SuiteStore } from "coverage-check";

// FileSystem store
const fsStore = new FileSystemSuiteStore("/path/to/store");

// S3 store (requires @aws-sdk/client-s3)
const s3Store = new S3SuiteStore({ bucket: "my-bucket", prefix: "coverage" });

await runCheck({
  rules: ".coverage-rules.yml",
  artifacts: "./coverage",
  base: "origin/main",
  head: "HEAD",
  pr: null,
  repo: "",
  json: null,
  stripPrefixes: [],
  store: s3Store,
  suite: "backend",
  branch: "main",
});

await runStorePut({
  suite: "backend",
  store: s3Store,
  artifacts: "./coverage",
  stripPrefixes: [],
  sha: "abc123",
  branch: "main",
});
```

You can also implement your own `SuiteStore`:

```ts
import type { SuiteStore } from "coverage-check";

class MyCustomStore implements SuiteStore {
  async list(): Promise<string[]> {
    /* ... */
  }
  async get(suite: string, opts?: { sha?: string; branch?: string }): Promise<Buffer | null> {
    /* ... */
  }
  async put(
    suite: string,
    lcov: Buffer,
    meta: { sha: string; branch: string; timestamp?: string },
  ): Promise<void> {
    /* ... */
  }
}
```

## License

[MIT](LICENSE)

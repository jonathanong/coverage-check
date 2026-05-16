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

### Suite store (conditional CI)

When only some CI suites run per PR (e.g. backend tests only when backend files change), store each suite's LCOV on every run and merge them when checking:

```sh
# After backend tests run — store this suite's coverage
coverage-check store-put \
  --suite backend \
  --store ./coverage-store \
  --artifacts ./coverage-artifacts \
  --sha "$GITHUB_SHA" \
  --ref "$GITHUB_REF"

# Sync the store directory to persistent storage (e.g. S3, git orphan branch)
aws s3 sync ./coverage-store s3://my-bucket/coverage-store/

# --- On the next PR that runs only frontend tests ---

# Pull the store
aws s3 sync s3://my-bucket/coverage-store/ ./coverage-store

# Store-put the current suite
coverage-check store-put --suite frontend --store ./coverage-store --artifacts ./coverage-artifacts

# Check: merges all stored suites (backend from baseline + frontend from this run)
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --store ./coverage-store \
  --suite frontend \
  --base origin/main \
  --head HEAD
```

The `--suite` flag on `check` tells the tool to replace the same-named suite in the store with the fresh `--artifacts` (so you always see this PR's coverage for the suite that ran, and historical coverage for suites that didn't).

### GitHub PR sticky comment

Pass `--pr` and `--repo` to post (or update) a sticky comment on a pull request. Requires the `gh` CLI and `GH_TOKEN`/`GITHUB_TOKEN`.

```sh
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --pr "${{ github.event.pull_request.number }}" \
  --repo "${{ github.repository }}"
```

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

| Flag             | Default                | Description                                                                  |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------- |
| `--rules`        | `.coverage-rules.yml`  | Path to YAML rules file                                                      |
| `--artifacts`    | `./coverage-artifacts` | Directory to scan for `lcov.info` files                                      |
| `--base`         | `origin/main`          | Base git ref for `git diff`                                                  |
| `--head`         | `HEAD`                 | Head git ref for `git diff`                                                  |
| `--store`        | —                      | Path to a suite store directory                                              |
| `--suite`        | —                      | Name of the current suite (fresh artifacts override this suite in the store) |
| `--strip-prefix` | —                      | Extra path prefix to strip from LCOV `SF:` lines (repeatable)                |
| `--pr`           | —                      | Pull request number for sticky comment                                       |
| `--repo`         | `$GITHUB_REPOSITORY`   | `owner/repo` for sticky comment                                              |
| `--json`         | —                      | Write JSON result to this path                                               |

### `coverage-check store-put`

| Flag             | Default                | Description                             |
| ---------------- | ---------------------- | --------------------------------------- |
| `--suite`        | required               | Suite name to store                     |
| `--store`        | required               | Path to the suite store directory       |
| `--artifacts`    | `./coverage-artifacts` | Directory to scan for `lcov.info` files |
| `--strip-prefix` | —                      | Extra path prefix to strip (repeatable) |
| `--sha`          | —                      | Git SHA to record in metadata           |
| `--ref`          | —                      | Git ref to record in metadata           |

## Programmatic API

```ts
import { runCheck, runStorePut, FileSystemSuiteStore } from "coverage-check";

// Custom store adapter (e.g. S3)
import { SuiteStore } from "coverage-check";

class S3SuiteStore implements SuiteStore {
  async list() {
    /* ... */
  }
  async get(suite: string) {
    /* ... */
  }
  async put(suite: string, lcov: Buffer, meta?: SuiteMeta) {
    /* ... */
  }
}

await runCheck({
  rules: ".coverage-rules.yml",
  artifacts: "./coverage",
  base: "origin/main",
  head: "HEAD",
  pr: null,
  repo: "",
  json: null,
  stripPrefixes: [],
  store: new S3SuiteStore(),
  suite: "backend",
});
```

## License

[MIT](LICENSE)

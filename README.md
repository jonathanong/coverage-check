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

For fan-in jobs where several suites may run at once, pass the complete active-suite manifest and
keep each fresh report under `coverage-<suite>/lcov.info`:

```sh
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --store-s3 my-bucket/coverage-store \
  --active-suite backend \
  --active-suite frontend \
  --drop-only \
  --drop-only-changed-areas \
  --branch main \
  --base origin/main \
  --head HEAD
```

In active-suite mode, stored coverage for each suite with a fresh report is replaced by that fresh
report. Stored coverage is retained for active suites that did not run, while stored suites absent
from the manifest are excluded. The baseline uses the stored versions of all available active
suites. Fresh suites are always included in current coverage, including newly introduced suites
that are not yet present in the manifest or store. `--drop-only` returns and prints only
`no_coverage_drop` results; it skips patch-coverage buckets and does not read the Git diff unless
`--drop-only-changed-areas` is also set.

**S3 key layout:**

```text
<prefix>/<suite>/sha/<sha>/lcov.info.gz       # gzip payload for new versioned writes
<prefix>/<suite>/branch/<encoded-branch>/latest.json  # pointer with sha, payloadKey, encoding, byte counts, timestamp
```

S3-backed stores need `s3:PutObject` for writes and `s3:GetObject` for reading branch pointers and baselines. The pointer reader also checks the previous unencoded pointer key (for example `branch/main/latest.json`) so stores written before branch-name encoding remain readable.

Versioned S3 writes (`store-put --sha ... --branch ...`) gzip the LCOV payload and write pointer
metadata with `payloadKey`, `encoding`, `rawBytes`, and `storedBytes`. Existing raw
`sha/<sha>/lcov.info` payloads and legacy `<suite>/lcov.info` payloads remain readable. Legacy
writes without `--sha`/`--branch` keep the old raw `<suite>/lcov.info` layout.

Every S3 operation logs a concise diagnostic line to stderr with the operation name, bucket, key,
elapsed time, and byte counts where applicable. Use these lines to distinguish payload writes,
branch-pointer reads, and branch-pointer writes when CI storage stalls.

S3 request bounds are configurable with environment variables:

| Variable                                  | Default | Purpose                                  |
| ----------------------------------------- | ------- | ---------------------------------------- |
| `COVERAGE_CHECK_S3_CONNECTION_TIMEOUT_MS` | `5000`  | Socket connection timeout for S3 calls   |
| `COVERAGE_CHECK_S3_REQUEST_TIMEOUT_MS`    | `30000` | Whole-request timeout for S3 calls       |
| `COVERAGE_CHECK_S3_MAX_ATTEMPTS`          | `2`     | AWS SDK attempt count, including retries |

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

When `$GITHUB_STEP_SUMMARY` is set, a per-suite totals and per-rule patch-coverage table is appended to the job summary automatically. Pass `--no-summary-file` to suppress this output without changing the environment variable.

### Diagnosing uncovered lines

Pass `--annotate-source` to print the trimmed source text of each uncovered line alongside its line number:

```
coverage-check: FAILED

  backend/**: 80.0% (4/5) — threshold 90%
    backend/foo.mts:
      L42  function f(a = 1) {
      L55  const { x } = opts
```

This makes it immediately clear which construct needs execution to satisfy V8/Istanbul line coverage.
Two common sources of confusion:

- **Default parameters** — `function f(a = 1)` is only fully covered when the function is called
  _without_ that argument so the default expression executes.
- **Shorthand object properties** — `const { x } = opts` is covered when `opts.x` is actually
  accessed during the test.

The annotation affects only the stdout failure output. The GitHub PR sticky comment and Actions step
summary are unchanged.

### Renamed and relocated files

`coverage-check` asks Git to detect renames with no rename-attempt limit before parsing patch lines.
Pure file moves do not create patch-coverage obligations: unchanged relocated lines are not treated
as newly added lines. If a moved file also changes content, Git still emits normal hunks for the
edited new-side lines, and those lines must satisfy the matching patch-coverage rule.

Large rewrites that fall below Git's rename similarity threshold may still appear as delete/add
pairs. In that case the destination file's executable lines are checked as new patch lines.

### Merging LCOV files

Use the `merge` subcommand to fold multiple `lcov.info` files into a single output that preserves function and branch records (`FN`, `FNDA`, `BRDA`) as well as summary counters (`LF/LH/FNF/FNH/BRF/BRH`):

```sh
coverage-check merge \
  --artifacts ./coverage-artifacts \
  --output ./coverage-merged/lcov.info
```

Hit counts are **summed** across inputs (consistent with the package's internal multi-suite merge). Parent directories of `--output` are created automatically.

### Advisory (non-blocking) mode

Pass `--advisory` to exit `0` even when coverage falls short. The check still runs in full — JSON is written, the PR comment is posted, and uncovered lines are printed — but the process never exits `1`. Useful for pre-push hooks where you want feedback without blocking the push:

```sh
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --base origin/main \
  --head HEAD \
  --advisory
```

For wrappers that need machine-readable advisory results without a temp file, pass `--json -`.
This writes JSON-only output to stdout and suppresses the human report:

```sh
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --base origin/main \
  --head HEAD \
  --advisory \
  --json -
```

JSON output keeps the normal check result fields (`passed`, `buckets`, `drops`, `informational`) and
adds `exitCode`, `advisory`, and `skipped`.

### PR-scoped regression gate

By default, `no_coverage_drop` applies to every rule area regardless of what changed. Pass `--drop-only-changed-areas` to restrict the drop gate to rule areas that contain at least one changed file in the PR diff. Areas with no changed files are reported as `skipped` — they pass non-blockingly:

```sh
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --base origin/main \
  --head HEAD \
  --drop-only-changed-areas
```

This avoids false positives when a CI run only exercises a subset of areas.

### Required artifacts

Pass `--require-artifact <relpath>` (repeatable) to fail early — exit `2` with a `::error::` annotation — if an expected `lcov.info` is absent from `--artifacts`. This distinguishes a missing coverage upload (CI job didn't run) from genuine uncovered lines:

```sh
coverage-check check \
  --rules .coverage-rules.yml \
  --artifacts ./coverage-artifacts \
  --require-artifact coverage-backend/lcov.info \
  --require-artifact coverage-frontend/lcov.info
```

`--require-artifact` is also accepted by `coverage-check merge`.

### Preparing fan-in artifacts

Use `prepare-artifacts` before a fan-in coverage check when downloaded artifacts may be either
nested as `coverage-<suite>/lcov.info` or flattened to a root-level `lcov.info`. Pass one
`--expect-suite <job>=<suite>` for each successful coverage producer. The command normalizes a
single flat LCOV into the expected suite directory and fails if any expected LCOV is missing:

```sh
coverage-check prepare-artifacts \
  --artifacts ./coverage-artifacts \
  --expect-suite test-backend=backend \
  --expect-suite test-web=web
```

For local or fan-in wrappers, `check --aggregate-artifacts` treats all fresh LCOV files as one source
for diagnostics, `check --fail-on-empty` exits `1` instead of skipping when no LCOV exists, and
`check --ignore-path <glob>` prepends a zero-threshold override for CI-only paths in that run.

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

### `no_coverage_drop`

Add `no_coverage_drop: true` to a rule to also gate total line-coverage regression — not just patch lines. When enabled, the check fails if the overall line-coverage percentage of files matched by that rule falls below the `main` baseline stored in the suite store.

```yaml
rules:
  - paths: backend/scripts/**
    patch_coverage_min: 0 # exempt from patch gate
  - paths: backend/**
    patch_coverage_min: 95
    no_coverage_drop: true # also gate overall regression
  - paths: web/**
    patch_coverage_min: 80
    no_coverage_drop: true
    max_coverage_drop: 0.5 # allow up to 0.5 percentage-point drop
```

`max_coverage_drop` (default `0`) sets the tolerance in percentage points. First-match-wins applies: `backend/scripts/**` files are matched by the earlier rule and are not included in the `backend/**` total.

**Requirements:**

- A suite store (`--store-s3` or `--store-fs`) must be configured on the `check` command.
- A baseline must exist in the store (written by `store-put --sha ... --branch main` on main pushes).
- When no baseline is available (e.g. fork PRs without store access), the no-drop check is **skipped non-blockingly** with a warning — the patch coverage gate still runs.

First-match-wins means that if you have a more specific rule before a broader one (e.g. `backend/scripts/**` before `backend/**`), only files matched by the broader rule's first-match contribute to its total — scripts are excluded from the broader `backend/**` aggregate.

## CLI reference

Run `coverage-check --help` or `coverage-check check --help` to print the available commands and check flags.

### `coverage-check check`

| Flag                        | Default                | Description                                                                                                |
| --------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--rules`                   | `.coverage-rules.yml`  | Path to YAML rules file                                                                                    |
| `--artifacts`               | `./coverage-artifacts` | Directory to scan for `lcov.info` files                                                                    |
| `--base`                    | `origin/main`          | Base git ref for `git diff`                                                                                |
| `--head`                    | `HEAD`                 | Head git ref for `git diff`                                                                                |
| `--store-fs`                | —                      | Path to a filesystem suite store directory                                                                 |
| `--store`                   | —                      | Alias for `--store-fs`                                                                                     |
| `--store-s3`                | —                      | S3 suite store spec: `<bucket>[/<prefix>]`                                                                 |
| `--branch`                  | `"main"`               | Branch pointer to follow when reading from the store                                                       |
| `--suite`                   | —                      | Name of the current suite (no `/` or `\\`); fresh artifacts override this suite in the store               |
| `--active-suite`            | —                      | Active suite for a multi-suite fresh-over-stored overlay (repeatable; mutually exclusive with `--suite`)   |
| `--strip-prefix`            | —                      | Extra path prefix to strip from LCOV `SF:` lines (repeatable)                                              |
| `--pr`                      | —                      | Pull request number for sticky comment                                                                     |
| `--repo`                    | `$GITHUB_REPOSITORY`   | `owner/repo` for sticky comment                                                                            |
| `--json`                    | —                      | Write JSON result to this path; use `-` for JSON-only stdout                                               |
| `--no-summary-file`         | —                      | Do not write the GitHub Actions step summary, even when `GITHUB_STEP_SUMMARY` is set                       |
| `--annotate-source`         | —                      | Print the trimmed source text of each uncovered line in stdout (does not alter PR comment or step summary) |
| `--advisory`                | —                      | Exit `0` even on shortfall; still prints, writes JSON, and posts PR comment                                |
| `--drop-only-changed-areas` | —                      | Restrict `no_coverage_drop` to rule areas that have ≥1 changed file; others are reported as skipped        |
| `--drop-only`               | —                      | Evaluate and print only `no_coverage_drop` results                                                         |
| `--require-artifact`        | —                      | Fail (exit `2`) if this relative path is absent under `--artifacts` (repeatable)                           |
| `--fail-on-empty`           | —                      | Exit `1` when no coverage data is found instead of skipping                                                |
| `--aggregate-artifacts`     | —                      | Treat fresh LCOV files as one source for diagnostics and summaries                                         |
| `--ignore-path`             | —                      | Prepend a zero-threshold override glob for this run (repeatable)                                           |

### `coverage-check merge`

| Flag                 | Default                | Description                                                   |
| -------------------- | ---------------------- | ------------------------------------------------------------- |
| `--artifacts`        | `./coverage-artifacts` | Directory to scan for `lcov.info` files                       |
| `--output`           | required               | Path to write the merged `lcov.info`                          |
| `--strip-prefix`     | —                      | Extra path prefix to strip from LCOV `SF:` lines (repeatable) |
| `--require-artifact` | —                      | Fail (exit `2`) if this relative path is absent (repeatable)  |

Hit counts are summed across all inputs. Function (`FN`/`FNDA`) and branch (`BRDA`) records are preserved; summary counters (`LF/LH/FNF/FNH/BRF/BRH`) are recomputed from the merged data.

### `coverage-check prepare-artifacts`

| Flag             | Default                | Description                                    |
| ---------------- | ---------------------- | ---------------------------------------------- |
| `--artifacts`    | `./coverage-artifacts` | Coverage artifact directory to normalize/check |
| `--expect-suite` | —                      | Expected producer and suite as `<job>=<suite>` |

### `coverage-check store-put`

| Flag             | Default                | Description                                                   |
| ---------------- | ---------------------- | ------------------------------------------------------------- |
| `--suite`        | required               | Suite name to store                                           |
| `--store-fs`     | required\*             | Path to a filesystem suite store directory                    |
| `--store`        | —                      | Alias for `--store-fs`                                        |
| `--store-s3`     | required\*             | S3 suite store spec: `<bucket>[/<prefix>]`                    |
| `--sha`          | —                      | Git SHA to associate with this coverage payload               |
| `--branch`       | —                      | Branch name for the pointer (e.g. `main` or `feature/foo`)    |
| `--artifacts`    | `./coverage-artifacts` | Directory to scan for `lcov.info` files                       |
| `--strip-prefix` | —                      | Extra path prefix to strip from LCOV `SF:` lines (repeatable) |

\* Exactly one of `--store-fs` or `--store-s3` is required.

When `--sha` and `--branch` are both provided, `store-put` writes a SHA-addressed payload and advances the branch pointer only if the incoming timestamp is not older than the current pointer. Omitting both flags preserves the legacy `<suite>/lcov.info` storage layout.

## Programmatic API

```ts
import {
  checkCoverage,
  evaluateCheck,
  runCheck,
  runMerge,
  runStorePut,
  prepareCoverageArtifacts,
  collapseRanges,
  collectLcovFiles,
  zeroThresholdGlobs,
  parseLcovFull,
  mergeLcovFull,
  toLcovFull,
  FileSystemSuiteStore,
  S3SuiteStore,
} from "coverage-check";

// FileSystem store
const fsStore = new FileSystemSuiteStore("/path/to/store");

// S3 store (requires AWS credentials — see https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)
const s3Store = new S3SuiteStore({ bucket: "my-bucket", prefix: "coverage" });

const check = await checkCoverage({
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
  advisory: true,
  dropOnlyChangedAreas: false,
  requireArtifacts: [],
});

if (!check.result?.passed) {
  console.log(check.exitCode, check.advisory, check.result);
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
  store: s3Store,
  suite: "backend",
  branch: "main",
  advisory: false,
  dropOnlyChangedAreas: false,
  requireArtifacts: [],
  failOnEmpty: false,
  aggregateArtifacts: false,
  ignorePaths: [],
});

const evaluated = await evaluateCheck({
  rules: ".coverage-rules.yml",
  artifacts: "./coverage",
  base: "origin/main",
  head: "HEAD",
  pr: null,
  repo: "",
  json: null,
  stripPrefixes: [],
  store: null,
  suite: null,
});
if (evaluated.result?.passed === false) {
  // Integrations can render their own advisory output from the typed result.
}

prepareCoverageArtifacts({
  artifacts: "./coverage-artifacts",
  expectedSuites: [{ job: "test-backend", suite: "backend" }],
});

collectLcovFiles("./coverage-artifacts");
zeroThresholdGlobs(".coverage-rules.yml");

await runMerge({
  artifacts: "./coverage-artifacts",
  output: "./coverage-merged/lcov.info",
  stripPrefixes: [],
  requireArtifacts: [],
});

await runStorePut({
  suite: "backend",
  store: s3Store,
  artifacts: "./coverage",
  stripPrefixes: [],
  sha: "abc123",
  branch: "main",
});

// Collapse a sorted line list into a compact range string
collapseRanges([1, 2, 3, 7, 8]); // → "L1-3, L7-8"
collapseRanges([1, 2, 3, 7, 8], ""); // → "1-3, 7-8"

// Full-fidelity LCOV (functions + branches + lines)
const full = parseLcovFull(lcovText, ["/home/runner/work/repo/repo/"]);
const merged = mergeLcovFull([full1, full2]); // hits are summed
const output = toLcovFull(merged); // includes FN/FNDA/BRDA and LF/LH/FNF/FNH/BRF/BRH
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
    meta?: { sha: string; branch: string; timestamp?: string },
  ): Promise<void> {
    /* ... */
  }
}
```

## License

[MIT](LICENSE)

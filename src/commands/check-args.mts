import { makeStore } from "../store-factory.mts";
import { assertSafePathComponent, assertValidRepo } from "../suite-store.mts";
import { parseArgs } from "../parse-args.mts";
import type { SuiteStore } from "../suite-store.mts";
import type { GhRunner } from "../github-comment.mts";

export type CheckArgs = {
  rules: string;
  artifacts: string;
  base: string;
  head: string;
  pr: number | null;
  repo: string;
  json: string | null;
  stripPrefixes: string[];
  store: SuiteStore | null;
  suite: string | null;
  /** Branch used to resolve baseline from the store. Default: "main". */
  branch?: string;
  gh?: GhRunner;
  /** Path to append the GitHub step summary. Default: $GITHUB_STEP_SUMMARY. */
  summaryFile?: string | null;
  /** Annotate each uncovered line with its trimmed source text in stdout. Default: false. */
  annotateSource?: boolean;
  /** Exit 0 even on coverage shortfall — compute and print, but never block. Default: false. */
  advisory?: boolean;
  /** Apply no_coverage_drop only to rules whose area has changed files in the diff. Default: false. */
  dropOnlyChangedAreas?: boolean;
  /** Relative paths under --artifacts that must exist before the check runs (repeatable). */
  requireArtifacts?: string[];
  /** Exit non-zero when no LCOV data is available instead of treating the check as skipped. */
  failOnEmpty?: boolean;
  /** Merge fresh LCOV artifacts before evaluating, so fan-in artifacts are treated as one source. */
  aggregateArtifacts?: boolean;
  /** Path globs to exempt by prepending zero-threshold override rules (repeatable). */
  ignorePaths?: string[];
};

export function parseCheckArgs(argv: string[]): CheckArgs {
  const parsed = parseArgs<{
    rules: string;
    artifacts: string;
    base: string;
    head: string;
    repo: string;
    json?: string;
    suite?: string;
    "strip-prefix": string[];
    branch: string;
    store?: string;
    "store-fs"?: string;
    "store-s3"?: string;
    pr?: string;
    "annotate-source": boolean;
    advisory: boolean;
    "drop-only-changed-areas": boolean;
    "require-artifact": string[];
    "fail-on-empty": boolean;
    "aggregate-artifacts": boolean;
    "ignore-path": string[];
  }>(argv, {
    rules: { type: "string", default: ".coverage-rules.yml" },
    artifacts: { type: "string", default: "./coverage-artifacts" },
    base: { type: "string", default: "origin/main" },
    head: { type: "string", default: "HEAD" },
    repo: { type: "string", default: process.env["GITHUB_REPOSITORY"] ?? "" },
    json: { type: "string" },
    suite: { type: "string" },
    "strip-prefix": { type: "string", multiple: true, default: [] },
    branch: { type: "string", default: "main" },
    store: { type: "string" },
    "store-fs": { type: "string" },
    "store-s3": { type: "string" },
    pr: { type: "string" },
    "annotate-source": { type: "boolean", default: false },
    advisory: { type: "boolean", default: false },
    "drop-only-changed-areas": { type: "boolean", default: false },
    "require-artifact": { type: "string", multiple: true, default: [] },
    "fail-on-empty": { type: "boolean", default: false },
    "aggregate-artifacts": { type: "boolean", default: false },
    "ignore-path": { type: "string", multiple: true, default: [] },
  });

  const storeFs = parsed.store ?? parsed["store-fs"] ?? null;
  const storeS3 = parsed["store-s3"] ?? null;
  if (storeFs && storeS3) throw new Error("--store-fs and --store-s3 are mutually exclusive");

  const suite = parsed.suite ?? null;
  if (suite !== null) assertSafePathComponent(suite, "suite");
  if (parsed.branch.length === 0)
    throw new Error(`invalid branch: ${JSON.stringify(parsed.branch)}`);
  let pr: number | null = null;
  if (parsed.pr !== undefined) {
    if (!/^\d+$/.test(parsed.pr) || parsed.pr === "0") {
      throw new Error(`--pr must be a positive integer, got: ${JSON.stringify(parsed.pr)}`);
    }
    pr = parseInt(parsed.pr, 10);
  }

  const repo = parsed.repo.trim();
  if (pr !== null && repo.length === 0) {
    throw new Error("--repo is required when --pr is set (or define GITHUB_REPOSITORY)");
  }
  const summaryFile = process.env["GITHUB_STEP_SUMMARY"];
  return {
    rules: parsed.rules,
    artifacts: parsed.artifacts,
    base: parsed.base,
    head: parsed.head,
    pr,
    repo: repo === "" ? "" : assertValidRepo(repo),
    json: parsed.json ?? null,
    stripPrefixes: parsed["strip-prefix"],
    store: makeStore({ fs: storeFs, s3: storeS3 }),
    suite,
    branch: parsed.branch,
    summaryFile,
    annotateSource: parsed["annotate-source"],
    advisory: parsed.advisory,
    dropOnlyChangedAreas: parsed["drop-only-changed-areas"],
    requireArtifacts: parsed["require-artifact"],
    failOnEmpty: parsed["fail-on-empty"],
    aggregateArtifacts: parsed["aggregate-artifacts"],
    ignorePaths: parsed["ignore-path"],
  };
}

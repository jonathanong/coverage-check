import { readFileSync, writeFileSync } from "node:fs";
import { parseLcov } from "../lcov-parser.mts";
import { mergeLcov } from "../lcov-merge.mts";
import { getChangedLines } from "../diff-parser.mts";
import { loadRules } from "../rules.mts";
import { computePatchCoverage } from "../patch-coverage.mts";
import { collapseRanges, renderFailureComment, renderPassComment } from "../report.mts";
import { upsertComment } from "../github-comment.mts";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { FileSystemSuiteStore } from "../suite-store.mts";
import type { LcovData } from "../types.mts";
import type { SuiteStore } from "../suite-store.mts";
import type { GhRunner } from "../github-comment.mts";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

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
  gh?: GhRunner;
};

function parseArgs(argv: string[]): CheckArgs {
  const args: CheckArgs = {
    rules: ".coverage-rules.yml",
    artifacts: "./coverage-artifacts",
    base: "origin/main",
    head: "HEAD",
    pr: null,
    repo: process.env["GITHUB_REPOSITORY"] ?? "",
    json: null,
    stripPrefixes: [],
    store: null,
    suite: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const next = argv[i + 1];
    const val = (): string => {
      if (next === undefined) throw new Error(`${flag} requires a value`);
      i++;
      return next;
    };
    switch (flag) {
      case "--rules":
        args.rules = val();
        break;
      case "--artifacts":
        args.artifacts = val();
        break;
      case "--base":
        args.base = val();
        break;
      case "--head":
        args.head = val();
        break;
      case "--pr": {
        const raw = val();
        if (!/^\d+$/.test(raw) || raw === "0")
          throw new Error(`--pr must be a positive integer, got: ${JSON.stringify(raw)}`);
        args.pr = parseInt(raw, 10);
        break;
      }
      case "--repo":
        args.repo = val();
        break;
      case "--json":
        args.json = val();
        break;
      case "--strip-prefix":
        args.stripPrefixes.push(val());
        break;
      case "--store":
        args.store = new FileSystemSuiteStore(val());
        break;
      case "--suite":
        args.suite = val();
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  return args;
}

export async function main(argv: string[]): Promise<number> {
  let args: CheckArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    /* c8 ignore next */
    stderr(`coverage-check: ${err instanceof Error ? err.message : err}`);
    return 2;
  }
  return runCheck(args);
}

export async function runCheck(args: CheckArgs): Promise<number> {
  let rules;
  try {
    rules = loadRules(args.rules);
  } catch (err) {
    stderr(`coverage-check: failed to load rules: ${err}`);
    return 2;
  }

  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const reports: LcovData[] = [];

  // Merge in suites from the store (skip the current suite — fresh artifacts take precedence)
  if (args.store !== null) {
    const suites = await args.store.list();
    for (const suite of suites) {
      if (suite === args.suite) continue;
      const buf = await args.store.get(suite);
      if (buf !== null) {
        reports.push(parseLcov(buf.toString("utf8"), stripPrefixes));
      }
    }
  }

  // Add current run's lcov files
  const lcovFiles = collectLcovFiles(args.artifacts);
  for (const f of lcovFiles) {
    reports.push(parseLcov(readFileSync(f, "utf8"), stripPrefixes));
  }

  if (reports.length === 0) {
    stderr(`coverage-check: no coverage data found — skipping`);
    return 0;
  }

  const lcov = mergeLcov(reports);

  let diff;
  try {
    diff = await getChangedLines(args.base, args.head);
  } catch (err) {
    stderr(`coverage-check: git diff failed: ${err}`);
    return 2;
  }

  const { buckets, informational } = computePatchCoverage(diff, lcov, rules);
  const passed = buckets.every((b) => b.passed);
  const result = { buckets, informational, passed };

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(result, null, 2));
  }

  const runUrl =
    process.env["GITHUB_SERVER_URL"] && process.env["GITHUB_RUN_ID"]
      ? `${process.env["GITHUB_SERVER_URL"]}/${args.repo}/actions/runs/${process.env["GITHUB_RUN_ID"]}`
      : "N/A";

  if (!passed) {
    stdout("\ncoverage-check: FAILED\n");
    for (const bucket of buckets.filter((b) => !b.passed)) {
      /* c8 ignore next -- buckets always have coverable>0 by construction */
      const pct =
        bucket.coverable > 0 ? `${((bucket.hit / bucket.coverable) * 100).toFixed(1)}%` : "—";
      stdout(
        `  ${bucket.rule}: ${pct} (${bucket.hit}/${bucket.coverable}) — threshold ${bucket.threshold}%`,
      );
      for (const file of bucket.files.filter((f) => f.uncoveredLines.length > 0)) {
        stdout(`    ${file.file}: ${collapseRanges(file.uncoveredLines)}`);
      }
    }
  } else {
    stdout("\ncoverage-check: PASSED\n");
    for (const bucket of buckets) {
      /* c8 ignore next -- buckets always have coverable>0 by construction */
      const pct =
        bucket.coverable > 0 ? `${((bucket.hit / bucket.coverable) * 100).toFixed(1)}%` : "—";
      stdout(`  ${bucket.rule}: ${pct} ✓`);
    }
  }

  if (args.pr !== null && args.repo) {
    const body = passed ? renderPassComment(runUrl) : renderFailureComment(result, runUrl);
    try {
      await upsertComment(body, args.repo, args.pr, passed, args.gh);
    } catch (err) {
      stderr(`coverage-check: failed to post PR comment: ${err}`);
    }
  }

  return passed ? 0 : 1;
}

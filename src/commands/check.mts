import { readFileSync, writeFileSync } from "node:fs";
import { parseLcov } from "../lcov-parser.mts";
import { mergeLcov } from "../lcov-merge.mts";
import { getChangedLines } from "../diff-parser.mts";
import { loadRules } from "../rules.mts";
import { computePatchCoverage } from "../patch-coverage.mts";
import { collapseRanges, renderFailureComment } from "../report.mts";
import { upsertComment } from "../github-comment.mts";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { writeSummary } from "../step-summary.mts";
import { parseCheckArgs } from "./check-args.mts";
import type { CheckArgs } from "./check-args.mts";
import type { SuiteSource } from "../step-summary.mts";
import type { LcovData } from "../types.mts";
export type { CheckArgs } from "./check-args.mts";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseCheckArgs(argv);
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

  const branch = args.branch ?? "main";
  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const reports: LcovData[] = [];
  const suiteSources: SuiteSource[] = [];

  if (args.store !== null) {
    const suites = await args.store.list();
    for (const suite of suites) {
      if (suite === args.suite) continue;
      const buf = await args.store.get(suite, { branch });
      if (buf !== null) {
        const lcov = parseLcov(buf.toString("utf8"), stripPrefixes);
        reports.push(lcov);
        suiteSources.push({ suite, source: "store", lcov });
      }
    }
  }

  const lcovFiles = collectLcovFiles(args.artifacts);
  const freshLcovs: LcovData[] = [];
  for (const f of lcovFiles) {
    const lcov = parseLcov(readFileSync(f, "utf8"), stripPrefixes);
    reports.push(lcov);
    freshLcovs.push(lcov);
  }
  if (freshLcovs.length > 0) {
    suiteSources.push({
      suite: args.suite ?? "(current)",
      source: "fresh",
      lcov: mergeLcov(freshLcovs),
    });
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

  const summaryFile = args.summaryFile ?? process.env["GITHUB_STEP_SUMMARY"] ?? null;
  if (summaryFile) {
    writeSummary(summaryFile, suiteSources, result, runUrl);
  }

  if (args.pr !== null && args.repo) {
    const body = passed ? "" : renderFailureComment(result, runUrl);
    try {
      await upsertComment(body, args.repo, args.pr, passed, args.gh);
    } catch (err) {
      stderr(`coverage-check: failed to post PR comment: ${err}`);
    }
  }

  return passed ? 0 : 1;
}

// oxlint-disable max-lines -- check evaluation and CLI rendering share one pipeline
import { readFileSync, writeFileSync } from "node:fs";
import { parseLcov } from "../lcov-parser.mts";
import { mergeLcov } from "../lcov-merge.mts";
import { getChangedLines } from "../diff-parser.mts";
import { getChangedLineContent } from "../diff-parser-content.mts";
import { loadRules, buildChangedRules, withIgnoredPaths } from "../rules.mts";
import { computePatchCoverage } from "../patch-coverage.mts";
import { computeCoverageDrop } from "../coverage-drop.mts";
import { collapseRanges, renderFailureComment } from "../report.mts";
import { upsertComment } from "../github-comment.mts";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { writeSummary } from "../step-summary.mts";
import { parseCheckArgs } from "./check-args.mts";
import {
  missingRequiredArtifacts,
  nonContributingWarnings,
  printDropOutput,
  checkRequiredArtifacts,
} from "./check-output.mts";
import type { CheckArgs } from "./check-args.mts";
import type { SuiteSource } from "../step-summary.mts";
import type { DiffLineContent, LcovData } from "../types.mts";
import type { CoverageCheckResult } from "../types.mts";
export type { CheckArgs } from "./check-args.mts";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

export type EvaluatedCheck = {
  exitCode: number;
  result: CoverageCheckResult | null;
  suiteSources: SuiteSource[];
  runUrl: string;
  branch: string;
  diffContent: DiffLineContent | null;
  skippedReason?: string;
  parsedSources: { name: string; lcov: LcovData }[];
  warnings: string[];
};

export async function main(argv: string[]): Promise<number> {
  let args: CheckArgs;
  try {
    args = parseCheckArgs(argv);
  } catch (err) {
    stderr(`coverage-check: ${String(err)}`);
    return 2;
  }
  return runCheck(args);
}

export async function evaluateCheck(args: CheckArgs): Promise<EvaluatedCheck> {
  const branch = args.branch ?? "main";
  const runUrl =
    process.env["GITHUB_SERVER_URL"] && process.env["GITHUB_RUN_ID"]
      ? `${process.env["GITHUB_SERVER_URL"]}/${args.repo}/actions/runs/${process.env["GITHUB_RUN_ID"]}`
      : "N/A";
  const emptyResult = (exitCode: number, skippedReason: string): EvaluatedCheck => ({
    exitCode,
    result: null,
    suiteSources: [],
    runUrl,
    branch,
    diffContent: null,
    skippedReason,
    parsedSources: [],
    warnings: [],
  });

  let rules;
  try {
    rules = withIgnoredPaths(loadRules(args.rules), args.ignorePaths);
  } catch (err) {
    return emptyResult(2, `failed to load rules: ${err}`);
  }

  if (missingRequiredArtifacts(args.artifacts, args.requireArtifacts ?? []).length > 0) {
    return emptyResult(2, "missing required coverage artifact");
  }

  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const reports: LcovData[] = [];
  const suiteSources: SuiteSource[] = [];
  const parsedSources: { name: string; lcov: LcovData }[] = [];

  if (args.store !== null) {
    const suites = await args.store.list();
    for (const suite of suites) {
      if (suite === args.suite) continue;
      const buf = await args.store.get(suite, { branch });
      if (buf !== null) {
        const lcov = parseLcov(buf.toString("utf8"), stripPrefixes);
        reports.push(lcov);
        suiteSources.push({ suite, source: "store", lcov });
        parsedSources.push({ name: `suite '${suite}'`, lcov });
      }
    }
  }

  const lcovFiles = collectLcovFiles(args.artifacts);
  const freshLcovs: LcovData[] = [];
  for (const f of lcovFiles) {
    const lcov = parseLcov(readFileSync(f, "utf8"), stripPrefixes);
    freshLcovs.push(lcov);
    if (!(args.aggregateArtifacts ?? false)) {
      reports.push(lcov);
      parsedSources.push({ name: `file '${f}'`, lcov });
    }
  }
  if (freshLcovs.length > 0) {
    const freshMerged = mergeLcov(freshLcovs);
    if (args.aggregateArtifacts ?? false) {
      reports.push(freshMerged);
      parsedSources.push({
        name: `aggregated artifacts under '${args.artifacts}'`,
        lcov: freshMerged,
      });
    }
    suiteSources.push({
      suite: args.suite ?? "(current)",
      source: "fresh",
      lcov: freshMerged,
    });
  }

  if (reports.length === 0) {
    return emptyResult(
      args.failOnEmpty ? 1 : 0,
      args.failOnEmpty
        ? `no coverage data found under ${args.artifacts}`
        : "no coverage data found — skipping",
    );
  }

  const lcov = mergeLcov(reports);

  let diff;
  let diffContent: DiffLineContent | null = null;
  try {
    if (args.annotateSource) {
      diffContent = await getChangedLineContent(args.base, args.head);
      diff = new Map(
        [...diffContent].map(([f, m]) => [f, new Set(m.keys())] as [string, Set<number>]),
      );
    } else {
      diff = await getChangedLines(args.base, args.head);
    }
  } catch (err) {
    return {
      exitCode: 2,
      result: null,
      suiteSources,
      runUrl,
      branch,
      diffContent: null,
      skippedReason: `git diff failed: ${err}`,
      parsedSources,
      warnings: [],
    };
  }

  const warnings = nonContributingWarnings(parsedSources, diff);

  let baseline: LcovData | null = null;
  if (args.store !== null) {
    try {
      const suites = await args.store.list();
      const baselineReports = (
        await Promise.all(
          suites.map(async (suite) => {
            const buf = await args.store!.get(suite, { branch });
            return buf === null ? null : parseLcov(buf.toString("utf8"), stripPrefixes);
          }),
        )
      ).filter((report): report is LcovData => report !== null);
      if (baselineReports.length > 0) {
        baseline = mergeLcov(baselineReports);
      }
    } catch (err) {
      stderr(`coverage-check: warning: failed to load baseline from store: ${String(err)}`);
    }
  }

  const { buckets, informational } = computePatchCoverage(diff, lcov, rules);
  const changedRules =
    (args.dropOnlyChangedAreas ?? false) ? buildChangedRules(diff, rules) : undefined;
  const drops = computeCoverageDrop(lcov, baseline, rules, changedRules);
  const passed = buckets.every((b) => b.passed) && drops.every((d) => d.passed || d.skipped);
  const result = { buckets, drops, informational, passed };

  return {
    exitCode: (args.advisory ?? false) || passed ? 0 : 1,
    result,
    suiteSources,
    runUrl,
    branch,
    diffContent,
    parsedSources,
    warnings,
  };
}

export async function runCheck(args: CheckArgs): Promise<number> {
  const evaluated = await evaluateCheck(args);

  if (evaluated.result === null) {
    if (evaluated.skippedReason) {
      if (evaluated.skippedReason === "missing required coverage artifact") {
        checkRequiredArtifacts(args.artifacts, args.requireArtifacts ?? []);
        return evaluated.exitCode;
      }
      stderr(`coverage-check: ${evaluated.skippedReason}`);
    }
    return evaluated.exitCode;
  }

  for (const warning of evaluated.warnings) stderr(warning);
  const result = evaluated.result;
  const diffContent = evaluated.diffContent;
  const passed = result.passed;

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(result, null, 2));
  }

  if (!passed) {
    stdout("\ncoverage-check: FAILED\n");
    for (const bucket of result.buckets.filter((b) => !b.passed)) {
      /* c8 ignore next -- bucket.coverable is always > 0 by patch-coverage.mts L36 guard */
      const pct =
        bucket.coverable > 0 ? `${((bucket.hit / bucket.coverable) * 100).toFixed(1)}%` : "—";
      stdout(
        `  ${bucket.rule}: ${pct} (${bucket.hit}/${bucket.coverable}) — threshold ${bucket.threshold}%`,
      );
      for (const file of bucket.files.filter((f) => f.uncoveredLines.length > 0)) {
        if (diffContent !== null) {
          stdout(`    ${file.file}:`);
          for (const lineNo of file.uncoveredLines) {
            /* c8 ignore next -- diffContent is single-sourced from the same diff, lineNo is always present */
            const text = diffContent.get(file.file)?.get(lineNo) ?? "";
            stdout(`      L${lineNo}  ${text}`);
          }
        } else {
          stdout(`    ${file.file}: ${collapseRanges(file.uncoveredLines)}`);
        }
      }
    }
  } else {
    stdout("\ncoverage-check: PASSED\n");
    for (const bucket of result.buckets) {
      /* c8 ignore next -- bucket.coverable is always > 0 by patch-coverage.mts L36 guard */
      const pct =
        bucket.coverable > 0 ? `${((bucket.hit / bucket.coverable) * 100).toFixed(1)}%` : "—";
      stdout(`  ${bucket.rule}: ${pct} ✓`);
    }
  }

  printDropOutput(result.drops);

  const summaryFile =
    args.summaryFile !== undefined
      ? args.summaryFile
      : (process.env["GITHUB_STEP_SUMMARY"] ?? null);
  if (summaryFile) {
    try {
      writeSummary(summaryFile, evaluated.suiteSources, result, evaluated.runUrl, evaluated.branch);
    } catch (err) {
      stderr(`coverage-check: failed to write step summary: ${err}`);
      return 2;
    }
  }

  if (args.pr !== null && args.repo) {
    const body = passed ? "" : renderFailureComment(result, evaluated.runUrl);
    try {
      await upsertComment(body, args.repo, args.pr, passed, args.gh);
    } catch (err) {
      stderr(`coverage-check: failed to post PR comment: ${err}`);
    }
  }

  return evaluated.exitCode;
}

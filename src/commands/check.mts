// oxlint-disable max-lines -- check evaluation and CLI rendering share one pipeline
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { parseLcov } from "../lcov-parser.mts";
import { mergeLcov } from "../lcov-merge.mts";
import { getChangedLines } from "../diff-parser.mts";
import { getChangedLineContent } from "../diff-parser-content.mts";
import { loadCoverageConfig, buildChangedRules, withIgnoredPaths } from "../rules.mts";
import { computePatchCoverage } from "../patch-coverage.mts";
import { computeCoverageDrop } from "../coverage-drop.mts";
import { collapseRanges, renderFailureComment } from "../report.mts";
import { upsertComment } from "../github-comment.mts";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { writeSummary } from "../step-summary.mts";
import { assertValidBaselineSnapshotKey } from "../baseline-snapshot.mts";
import {
  decodeBaselineSnapshotLcov,
  formatBaselineSnapshotDiagnostic,
  loadBaselineSnapshot,
} from "../baseline-snapshot-loader.mts";
import { assertSafePathComponent } from "../suite-store.mts";
import { parseCheckArgs } from "./check-args.mts";
import { checkHelp } from "./check-render.mts";
import { emptyResult, toJsonPayload } from "./check-result.mts";
import {
  missingRequiredArtifacts,
  nonContributingWarnings,
  printDropOutput,
  checkRequiredArtifacts,
} from "./check-output.mts";
import type { CheckArgs } from "./check-args.mts";
import type { CheckRunResult } from "./check-result.mts";
import type { SuiteSource } from "../step-summary.mts";
import type { CoverageCheckResult, DiffLineContent, DiffLines, LcovData } from "../types.mts";
export type { CheckArgs } from "./check-args.mts";
export type { CheckRunResult } from "./check-result.mts";

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

type LoadedActiveSuiteCoverage = {
  baseline: LcovData | null;
  reports: LcovData[];
  suiteSources: SuiteSource[];
  parsedSources: { name: string; lcov: LcovData }[];
};

type StoredSuiteCoverage = { suite: string; lcov: LcovData };

function validateCheckArgs(args: CheckArgs): void {
  const activeSuites = args.activeSuites ?? [];
  if (args.suite !== null && activeSuites.length > 0) {
    throw new Error("suite and activeSuites are mutually exclusive");
  }
  for (const suite of activeSuites) assertSafePathComponent(suite, "suite");
  if (args.baselineSnapshotKey !== undefined && args.baselineSnapshotKey !== null) {
    assertValidBaselineSnapshotKey(args.baselineSnapshotKey);
    if (args.store === null) throw new Error("baselineSnapshotKey requires a suite store");
  }
}

function suiteName(lcovPath: string, artifacts: string): string {
  const segments = relative(artifacts, lcovPath).split(/[/\\]/);
  for (let index = segments.length - 2; index >= 0; index -= 1) {
    const directory = segments[index];
    if (!directory?.startsWith("coverage-") || directory === "coverage-") continue;
    const suite = directory.slice("coverage-".length);
    assertSafePathComponent(suite, "suite");
    return suite;
  }
  throw new Error(`expected LCOV parent directory to match coverage-<suite>: ${lcovPath}`);
}

async function loadActiveSuiteCoverage(
  args: CheckArgs,
  branch: string,
  stripPrefixes: string[],
  pinnedStoredSuites?: StoredSuiteCoverage[],
): Promise<LoadedActiveSuiteCoverage> {
  const activeSuites = new Set(args.activeSuites!);
  const freshBySuite = new Map<string, LcovData[]>();
  for (const file of collectLcovFiles(args.artifacts)) {
    const suite = suiteName(file, args.artifacts);
    const reports = freshBySuite.get(suite) ?? [];
    reports.push(parseLcov(readFileSync(file, "utf8"), stripPrefixes));
    freshBySuite.set(suite, reports);
  }
  const freshSuites = [...freshBySuite].map(([suite, reports]) => ({
    suite,
    lcov: mergeLcov(reports),
  }));
  const freshSuiteNames = new Set(freshSuites.map(({ suite }) => suite));

  const storedSuites: StoredSuiteCoverage[] = [];
  if (pinnedStoredSuites !== undefined) {
    storedSuites.push(...pinnedStoredSuites);
  } else if (args.store !== null) {
    const loaded = await Promise.all(
      [...activeSuites].map(async (suite) => {
        const buffer = await args.store!.get(suite, { branch });
        return buffer === null
          ? null
          : { suite, lcov: parseLcov(buffer.toString("utf8"), stripPrefixes) };
      }),
    );
    storedSuites.push(
      ...loaded.filter((stored): stored is { suite: string; lcov: LcovData } => stored !== null),
    );
  }

  const currentStoredSuites = storedSuites.filter(({ suite }) => !freshSuiteNames.has(suite));
  const currentSuites = [
    ...currentStoredSuites.map(({ suite, lcov }) => ({ suite, lcov, source: "store" as const })),
    ...freshSuites.map(({ suite, lcov }) => ({ suite, lcov, source: "fresh" as const })),
  ];
  return {
    baseline: storedSuites.length === 0 ? null : mergeLcov(storedSuites.map(({ lcov }) => lcov)),
    reports: currentSuites.map(({ lcov }) => lcov),
    suiteSources: currentSuites,
    parsedSources: currentSuites.map(({ suite, source, lcov }) => ({
      name: `suite '${suite}' (${source})`,
      lcov,
    })),
  };
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    stdout(checkHelp());
    return 0;
  }

  let args: CheckArgs;
  try {
    args = parseCheckArgs(argv);
  } catch (err) {
    stderr(`coverage-check: ${String(err)}`);
    return 2;
  }
  return runCheck(args);
}

export async function checkCoverage(args: CheckArgs): Promise<CheckRunResult> {
  return toCheckRunResult(args, await evaluateCheck(args));
}

function toCheckRunResult(args: CheckArgs, evaluated: EvaluatedCheck): CheckRunResult {
  const skippedReason = evaluated.skippedReason ?? null;
  const skipped =
    evaluated.result === null &&
    skippedReason !== null &&
    skippedReason.startsWith("no coverage data found") &&
    !(args.failOnEmpty ?? false);
  return {
    result: evaluated.result ?? (skipped ? emptyResult(true) : null),
    exitCode: evaluated.exitCode as 0 | 1 | 2,
    advisory: args.advisory ?? false,
    skipped,
    error: skipped ? null : skippedReason,
    warnings: skipped ? [`coverage-check: ${skippedReason}`] : evaluated.warnings,
  };
}

export async function evaluateCheck(args: CheckArgs): Promise<EvaluatedCheck> {
  const branch = args.branch ?? "main";
  const runUrl =
    process.env["GITHUB_SERVER_URL"] && process.env["GITHUB_RUN_ID"]
      ? `${process.env["GITHUB_SERVER_URL"]}/${args.repo}/actions/runs/${process.env["GITHUB_RUN_ID"]}`
      : "N/A";
  const emptyEvaluation = (exitCode: number, skippedReason: string): EvaluatedCheck => ({
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

  try {
    validateCheckArgs(args);
  } catch (err) {
    return emptyEvaluation(2, `invalid check configuration: ${err}`);
  }

  let rules;
  let scope;
  try {
    const config = loadCoverageConfig(args.rules);
    rules = withIgnoredPaths(config.rules, args.ignorePaths);
    scope = config.scope;
  } catch (err) {
    return emptyEvaluation(2, `failed to load rules: ${err}`);
  }

  if (missingRequiredArtifacts(args.artifacts, args.requireArtifacts ?? []).length > 0) {
    return emptyEvaluation(2, "missing required coverage artifact");
  }

  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const reports: LcovData[] = [];
  const suiteSources: SuiteSource[] = [];
  const parsedSources: { name: string; lcov: LcovData }[] = [];
  const activeSuiteMode = (args.activeSuites?.length ?? 0) > 0;
  let baseline: LcovData | null = null;
  let pinnedStoredSuites: StoredSuiteCoverage[] | undefined;
  let baselineSnapshotDiagnostic: string | null = null;

  if (args.baselineSnapshotKey !== undefined && args.baselineSnapshotKey !== null) {
    try {
      const loaded = await loadBaselineSnapshot(
        args.store!,
        args.baselineSnapshotKey,
        branch,
        activeSuiteMode ? args.activeSuites : undefined,
      );
      pinnedStoredSuites = loaded.suites.map(({ suite, buffer }) => ({
        suite,
        lcov: parseLcov(decodeBaselineSnapshotLcov(buffer), stripPrefixes),
      }));
      baselineSnapshotDiagnostic = formatBaselineSnapshotDiagnostic(loaded);
    } catch (err) {
      return emptyEvaluation(2, `failed to load baseline snapshot: ${err}`);
    }
  }

  if (activeSuiteMode) {
    try {
      const loaded = await loadActiveSuiteCoverage(args, branch, stripPrefixes, pinnedStoredSuites);
      reports.push(...loaded.reports);
      suiteSources.push(...loaded.suiteSources);
      parsedSources.push(...loaded.parsedSources);
      baseline = loaded.baseline;
    } catch (err) {
      return emptyEvaluation(2, `failed to load multi-suite coverage: ${err}`);
    }
  } else {
    if (pinnedStoredSuites !== undefined) {
      for (const { suite, lcov } of pinnedStoredSuites) {
        if (suite === args.suite) continue;
        reports.push(lcov);
        suiteSources.push({ suite, source: "store", lcov });
        parsedSources.push({ name: `suite '${suite}'`, lcov });
      }
    } else if (args.store !== null) {
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
  }

  if (reports.length === 0 && scope === undefined) {
    return emptyEvaluation(
      args.failOnEmpty ? 1 : 0,
      args.failOnEmpty
        ? `no coverage data found under ${args.artifacts}`
        : "no coverage data found — skipping",
    );
  }

  const lcov: LcovData = reports.length === 0 ? new Map() : mergeLcov(reports);

  let diff: DiffLines = new Map();
  let diffContent: DiffLineContent | null = null;
  if (!(args.dropOnly ?? false) || (args.dropOnlyChangedAreas ?? false)) {
    try {
      if (args.annotateSource && !(args.dropOnly ?? false)) {
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
  }

  const warnings = args.dropOnly ? [] : nonContributingWarnings(parsedSources, diff);
  if (baselineSnapshotDiagnostic !== null) warnings.push(baselineSnapshotDiagnostic);

  if (!activeSuiteMode && pinnedStoredSuites !== undefined) {
    if (pinnedStoredSuites.length > 0) {
      baseline = mergeLcov(pinnedStoredSuites.map(({ lcov }) => lcov));
    }
  } else if (!activeSuiteMode && args.store !== null) {
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
      warnings.push(`coverage-check: warning: failed to load baseline from store: ${String(err)}`);
    }
  }

  let patchCoverage;
  try {
    patchCoverage = args.dropOnly
      ? { buckets: [], informational: [], missingCoverage: [] }
      : computePatchCoverage(diff, lcov, rules, scope, (file) => {
          // Git is intentionally PATH-resolved for cross-platform support; execFileSync does not use a shell.
          return execFileSync("git", ["show", `${args.head}:${file}`], { encoding: "utf8" }); // NOSONAR
        });
  } catch (error) {
    return {
      exitCode: 2,
      result: null,
      suiteSources,
      runUrl,
      branch,
      diffContent,
      skippedReason: `coverage scope analysis failed: ${String(error)}`,
      parsedSources,
      warnings,
    };
  }
  const { buckets, informational, missingCoverage } = patchCoverage;
  if (reports.length === 0 && missingCoverage.length === 0) {
    return emptyEvaluation(
      args.failOnEmpty ? 1 : 0,
      args.failOnEmpty
        ? `no coverage data found under ${args.artifacts}`
        : "no coverage data found — skipping",
    );
  }
  const changedRules =
    (args.dropOnlyChangedAreas ?? false) ? buildChangedRules(diff, rules) : undefined;
  const drops = computeCoverageDrop(lcov, baseline, rules, changedRules);
  const passed =
    buckets.every((b) => b.passed) &&
    missingCoverage.length === 0 &&
    drops.every((d) => d.passed || d.skipped);
  const result = { buckets, drops, informational, missingCoverage, passed };

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
  const check = toCheckRunResult(args, evaluated);
  const jsonToStdout = args.json === "-";

  if (evaluated.result === null) {
    if (evaluated.skippedReason === "missing required coverage artifact") {
      if (args.json) writeJson(args.json, check);
      checkRequiredArtifacts(args.artifacts, args.requireArtifacts!);
      return evaluated.exitCode;
    }
    if (args.json) writeJson(args.json, check);
    if (check.error !== null) stderr(`coverage-check: ${check.error}`);
    for (const warning of check.warnings) stderr(warning);
    return evaluated.exitCode;
  }

  for (const warning of evaluated.warnings) stderr(warning);
  const result = evaluated.result;
  const diffContent = evaluated.diffContent;
  const passed = result.passed;

  if (args.json) writeJson(args.json, check);
  if (!jsonToStdout) {
    if (args.dropOnly) printDropOutput(result.drops);
    else printHumanResult(result, diffContent);
  }

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

function writeJson(path: string, check: CheckRunResult): void {
  const json = `${JSON.stringify(toJsonPayload(check), null, 2)}\n`;
  if (path === "-") process.stdout.write(json);
  else writeFileSync(path, json);
}

function printHumanResult(result: CoverageCheckResult, diffContent: DiffLineContent | null): void {
  if (!result.passed) {
    stdout("\ncoverage-check: FAILED\n");
    for (const missing of result.missingCoverage) {
      /* c8 ignore next -- exact missing-coverage prose is covered by report and summary renderers */
      stdout(
        `  ${missing.file}: missing coverage record for ${collapseRanges(missing.lines)} (rule ${missing.rule})`,
      );
    }
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
}

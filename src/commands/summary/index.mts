import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseLcov } from "../../lcov-parser.mts";
import { mergeLcov } from "../../lcov-merge.mts";
import { collectLcovFiles, buildStripPrefixes } from "../../load-artifacts.mts";
import { makeStore } from "../../store-factory.mts";
import type { SuiteStore } from "../../suite-store.mts";
import { parseCoverageSummaryArgs } from "./args.mts";
import { groupSuitesBySourceFolder } from "./groups.mts";
import { renderCoverageSummaryMarkdown, suiteTotals } from "./markdown.mts";
import type {
  CoverageSummary,
  CoverageSummaryArgs,
  CoverageTotals,
  LcovData,
  SuiteCoverage,
} from "./types.mts";

export type { CoverageSummary, CoverageSummaryArgs, SuiteCoverage };
export {
  groupSuitesBySourceFolder,
  parseCoverageSummaryArgs,
  renderCoverageSummaryMarkdown,
  suiteTotals,
};

type HistoricalSuiteResult = SuiteCoverage | { missingSuite: string };

function suiteNameFromArtifactDir(name: string): string | null {
  if (!name.startsWith("coverage-")) return null;
  const suite = name.slice("coverage-".length);
  return suite.length > 0 ? suite : null;
}

function loadSuiteCoverage(suite: string, files: string[], stripPrefixes: string[]): SuiteCoverage {
  const reports = files.map((file) => parseLcov(readFileSync(file, "utf8"), stripPrefixes));
  return { suite, source: "current", lcov: mergeLcov(reports) };
}

function loadCurrentSuites(artifacts: string, stripPrefixes: string[]): SuiteCoverage[] {
  if (!existsSync(artifacts)) return [];
  return readdirSync(artifacts, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const suite = suiteNameFromArtifactDir(entry.name);
      if (!suite) return null;
      const files = collectLcovFiles(path.join(artifacts, entry.name));
      return files.length === 0 ? null : loadSuiteCoverage(suite, files, stripPrefixes);
    })
    .filter((suite): suite is SuiteCoverage => suite !== null)
    .sort((a, b) => a.suite.localeCompare(b.suite));
}

async function loadHistoricalSuites(
  store: SuiteStore | null,
  branch: string,
  activeSuiteNames: Set<string>,
  currentSuiteNames: Set<string>,
  stripPrefixes: string[],
): Promise<{ suites: SuiteCoverage[]; warnings: string[] }> {
  if (store === null) {
    return {
      suites: [],
      warnings: [
        "Historical main coverage store was not configured; showing current-run coverage only.",
      ],
    };
  }
  if (activeSuiteNames.size === 0) {
    return {
      suites: [],
      warnings: [
        "Historical main coverage store was configured without an active suite manifest; showing current-run coverage only.",
      ],
    };
  }
  try {
    const historicalSuites = [...activeSuiteNames].filter((suite) => !currentSuiteNames.has(suite));
    const historical: HistoricalSuiteResult[] = await Promise.all(
      historicalSuites.map(async (suite) => {
        const lcovBuffer = await store.get(suite, { branch });
        if (lcovBuffer === null) return { missingSuite: suite };
        return {
          suite,
          source: "history" as const,
          branch,
          lcov: parseLcov(lcovBuffer.toString("utf8"), stripPrefixes),
        };
      }),
    );
    const suites = historical.filter(
      (suite): suite is SuiteCoverage => "lcov" in suite && "suite" in suite,
    );
    const missingSuites = historical
      .filter((suite): suite is { missingSuite: string } => "missingSuite" in suite)
      .map((suite) => suite.missingSuite);
    return {
      suites,
      warnings:
        missingSuites.length === 0
          ? []
          : [
              `Historical main coverage missing for active suites: ${missingSuites.sort((a, b) => a.localeCompare(b)).join(", ")}.`,
            ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { suites: [], warnings: [`Historical main coverage could not be read: ${message}`] };
  }
}

function mergedTotals(suites: SuiteCoverage[]): CoverageTotals {
  const lcov: LcovData = mergeLcov(suites.map((suite) => suite.lcov));
  return suiteTotals({ lcov });
}

export async function buildCoverageSummary(args: CoverageSummaryArgs): Promise<CoverageSummary> {
  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const currentSuites = loadCurrentSuites(args.artifacts, stripPrefixes);
  const currentTotals = mergedTotals(currentSuites);
  const historical = await loadHistoricalSuites(
    makeStore({ fs: args.storeFs, s3: args.storeS3 }),
    args.branch,
    new Set(args.activeSuites),
    new Set(currentSuites.map((suite) => suite.suite)),
    stripPrefixes,
  );
  const suites = [...currentSuites, ...historical.suites].sort((a, b) =>
    a.suite.localeCompare(b.suite),
  );
  return {
    currentTotals,
    groups: groupSuitesBySourceFolder(suites, args.branch, args.rulesFile),
    suites,
    totals: mergedTotals(suites),
    warnings: historical.warnings,
  };
}

export async function main(argv: string[]): Promise<number> {
  let args: CoverageSummaryArgs;
  try {
    args = parseCoverageSummaryArgs(argv);
  } catch (err) {
    process.stderr.write(`coverage-check summary: ${String(err)}\n`);
    return 2;
  }
  const summary = await buildCoverageSummary(args);
  const markdown = renderCoverageSummaryMarkdown(summary, args.branch, args.storeS3);
  if (args.summaryFile) appendFileSync(args.summaryFile, markdown, "utf8");
  else process.stdout.write(markdown);
  return 0;
}

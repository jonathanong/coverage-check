import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { compareCoverageSummaries } from "../coverage-summary-comparison.mts";
import type {
  CoverageSummaryComparison,
  IstanbulCoverageSummary,
} from "../coverage-summary-comparison-types.mts";

type CompareSummaryArgs = {
  baseSummary: string;
  headSummary: string;
  baseRoot: string;
  headRoot: string;
  jsonPath: string | null;
};

const stdout = (message: string) => process.stdout.write(`${message}\n`);
const stderr = (message: string) => process.stderr.write(`${message}\n`);

function parseArgs(argv: string[]): CompareSummaryArgs {
  const args: CompareSummaryArgs = {
    baseSummary: "",
    headSummary: "",
    baseRoot: "",
    headRoot: "",
    jsonPath: null,
  };
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (seen.has(flag)) throw new Error(`duplicate flag: ${flag}`);
    seen.add(flag);
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined || !next.trim() || next.startsWith("--"))
        throw new Error(`${flag} requires a value`);
      index += 1;
      return next;
    };
    switch (flag) {
      case "--base-summary":
        args.baseSummary = value();
        break;
      case "--head-summary":
        args.headSummary = value();
        break;
      case "--base-root":
        args.baseRoot = value();
        break;
      case "--head-root":
        args.headRoot = value();
        break;
      case "--json":
        args.jsonPath = value();
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  for (const [flag, value] of [
    ["--base-summary", args.baseSummary],
    ["--head-summary", args.headSummary],
    ["--base-root", args.baseRoot],
    ["--head-root", args.headRoot],
  ] as const) {
    if (value.length === 0) throw new Error(`${flag} is required`);
  }
  return args;
}

function formatMetric({
  covered,
  total,
  pct,
}: {
  covered: number;
  total: number;
  pct: number;
}): string {
  return `${pct.toFixed(2)}% (${covered}/${total})`;
}

export function renderComparison(result: CoverageSummaryComparison): string {
  const lines = ["coverage-check compare-summary", "", "Base totals:"];
  for (const metric of ["lines", "statements", "functions", "branches"] as const)
    lines.push(`  ${metric}: ${formatMetric(result.base[metric])}`);
  lines.push("Head totals:");
  for (const metric of ["lines", "statements", "functions", "branches"] as const)
    lines.push(`  ${metric}: ${formatMetric(result.head[metric])}`);
  if (result.passed)
    return [...lines, "", "coverage-check: coverage summary comparison passed"].join("\n");
  lines.push("", "coverage-check: COVERAGE REGRESSION");
  for (const regression of result.regressions) {
    if (regression.kind === "aggregate-decrease")
      lines.push(
        `  total ${regression.metric}: ${formatMetric(regression.head)} (was ${formatMetric(regression.base)})`,
      );
    else if (regression.kind === "missing-file")
      lines.push(`  ${regression.file}: missing from head summary`);
    else
      lines.push(
        `  ${regression.file} ${regression.metric}: ${formatMetric(regression.head)} (was ${formatMetric(regression.base)})`,
      );
  }
  return lines.join("\n");
}

function parseJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `failed to read ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function main(argv: string[]): Promise<number> {
  try {
    if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
      stdout(compareSummaryHelp());
      return 0;
    }
    const args = parseArgs(argv);
    const result = compareCoverageSummaries(
      parseJson(args.baseSummary, "base summary") as IstanbulCoverageSummary,
      parseJson(args.headSummary, "head summary") as IstanbulCoverageSummary,
      args.baseRoot,
      args.headRoot,
    );
    if (args.jsonPath !== null) {
      mkdirSync(dirname(args.jsonPath), { recursive: true });
      writeFileSync(args.jsonPath, `${JSON.stringify(result, null, 2)}\n`);
    }
    stdout(renderComparison(result));
    return result.passed ? 0 : 1;
  } catch (error) {
    stderr(
      `coverage-check compare-summary: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

export function compareSummaryHelp(): string {
  return `coverage-check compare-summary

Usage:
  coverage-check compare-summary --base-summary <path> --head-summary <path> --base-root <path> --head-root <path> [--json <path>]

Compare historical Istanbul coverage-summary JSON files after excluding test sources. Exits 0 on pass, 1 on regression, and 2 on invalid input.`;
}

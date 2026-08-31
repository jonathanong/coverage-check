import { posix, win32 } from "node:path";

import { coverageSummaryMetrics } from "./coverage-summary-comparison-types.mts";
import type {
  CoverageSummaryComparison,
  CoverageSummaryCount,
  CoverageSummaryMetricName,
  CoverageSummaryRegression,
  CoverageSummaryTotals,
  IstanbulCoverageSummary,
} from "./coverage-summary-comparison-types.mts";

type JsonRecord = Record<string, unknown>;
type FileSummary = Record<CoverageSummaryMetricName, CoverageSummaryCount>;
type NormalizedSummary = Map<string, FileSummary>;
type PathImplementation = typeof posix;
type NormalizedRoot = { path: string; implementation: PathImplementation };

const nativePath = process.platform === "win32" ? win32 : posix;

function isWindowsAbsolute(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\\\");
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const leftPoint = leftPoints[index]!;
    const rightPoint = rightPoints[index]!;
    if (leftPoint < rightPoint) return -1;
    if (leftPoint > rightPoint) return 1;
  }
  return leftPoints.length - rightPoints.length;
}

function asRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function validCount(value: unknown, label: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(`${label} must be a finite nonnegative integer`);
  }
  return value;
}

function parseMetric(value: unknown, label: string): CoverageSummaryCount {
  const metric = asRecord(value, label);
  const covered = validCount(metric["covered"], `${label}.covered`);
  const total = validCount(metric["total"], `${label}.total`);
  if (covered > total) throw new Error(`${label}.covered must not exceed total`);
  return { covered, total };
}

function normalizeRoot(root: string, label: string): NormalizedRoot {
  if (!root.trim()) throw new Error(`${label} root must not be empty`);
  const implementation = isWindowsAbsolute(root)
    ? win32
    : posix.isAbsolute(root)
      ? posix
      : nativePath;
  return { path: implementation.resolve(root), implementation };
}

function normalizeSource(source: string, root: NormalizedRoot, label: string): string {
  if (!source.trim()) throw new Error(`${label} source must not be empty`);
  const { implementation } = root;
  const foreignAbsolute =
    (implementation === win32 && posix.isAbsolute(source)) ||
    (implementation === posix && isWindowsAbsolute(source));
  const absolute = implementation.resolve(root.path, source);
  const normalized = implementation.relative(root.path, absolute);
  if (
    foreignAbsolute ||
    normalized.length === 0 ||
    normalized === ".." ||
    normalized.startsWith(`..${implementation.sep}`) ||
    implementation.isAbsolute(normalized)
  ) {
    throw new Error(`${label} source is outside root: ${source}`);
  }
  return normalized.split(implementation.sep).join("/");
}

function excludedSource(source: string): boolean {
  const parts = source.split("/");
  if (parts.some((part) => part === "__tests__" || part === "test" || part === "tests"))
    return true;
  return /\.(?:test|spec|stories)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/.test(source);
}

function normalizeSummary(
  input: IstanbulCoverageSummary,
  root: string,
  label: string,
): NormalizedSummary {
  const rootPath = normalizeRoot(root, label);
  const summary = asRecord(input, `${label} summary`);
  const normalized = new Map<string, FileSummary>();
  const rawTotal = summary["total"];
  if (rawTotal === undefined) throw new Error(`${label} summary total is missing`);
  const total = asRecord(rawTotal, `${label} summary total`);
  for (const metric of coverageSummaryMetrics)
    parseMetric(total[metric], `${label} summary total.${metric}`);
  for (const source of Object.keys(summary).sort(compareCodePoints)) {
    if (source === "total") continue;
    const file = normalizeSource(source, rootPath, label);
    if (excludedSource(file)) continue;
    if (normalized.has(file))
      throw new Error(`${label} summary has duplicate normalized source: ${file}`);
    const rawFile = asRecord(summary[source], `${label} summary source ${source}`);
    normalized.set(file, {
      lines: parseMetric(rawFile["lines"], `${label} summary source ${source}.lines`),
      statements: parseMetric(
        rawFile["statements"],
        `${label} summary source ${source}.statements`,
      ),
      functions: parseMetric(rawFile["functions"], `${label} summary source ${source}.functions`),
      branches: parseMetric(rawFile["branches"], `${label} summary source ${source}.branches`),
    });
  }
  return normalized;
}

function percentage({ covered, total }: CoverageSummaryCount): number {
  return total === 0 ? 100 : (covered / total) * 100;
}

function aggregate(summary: NormalizedSummary): CoverageSummaryTotals {
  const totals = Object.fromEntries(
    coverageSummaryMetrics.map((metric) => [metric, { covered: 0, total: 0, pct: 100 }]),
  ) as CoverageSummaryTotals;
  for (const file of summary.values()) {
    for (const metric of coverageSummaryMetrics) {
      totals[metric].covered += file[metric].covered;
      totals[metric].total += file[metric].total;
    }
  }
  for (const metric of coverageSummaryMetrics) totals[metric].pct = percentage(totals[metric]);
  return totals;
}

function withPercentage(count: CoverageSummaryCount): CoverageSummaryCount & { pct: number } {
  return { ...count, pct: percentage(count) };
}

export function compareCoverageSummaries(
  baseSummary: IstanbulCoverageSummary,
  headSummary: IstanbulCoverageSummary,
  baseRoot: string,
  headRoot: string,
): CoverageSummaryComparison {
  const baseFiles = normalizeSummary(baseSummary, baseRoot, "base");
  const headFiles = normalizeSummary(headSummary, headRoot, "head");
  const base = aggregate(baseFiles);
  const head = aggregate(headFiles);
  const regressions: CoverageSummaryRegression[] = [];

  for (const file of [...baseFiles.keys()].sort(compareCodePoints)) {
    const base = baseFiles.get(file)!;
    const head = headFiles.get(file);
    if (head === undefined) {
      regressions.push({ kind: "missing-file", file });
      continue;
    }
    for (const metric of coverageSummaryMetrics) {
      const baseMetric = withPercentage(base[metric]);
      const headMetric = withPercentage(head[metric]);
      if (headMetric.pct < baseMetric.pct) {
        regressions.push({ kind: "decrease", file, metric, base: baseMetric, head: headMetric });
      }
    }
  }

  for (const metric of coverageSummaryMetrics) {
    if (head[metric].pct < base[metric].pct) {
      regressions.push({
        kind: "aggregate-decrease",
        metric,
        base: base[metric],
        head: head[metric],
      });
    }
  }

  return { passed: regressions.length === 0, base, head, regressions };
}

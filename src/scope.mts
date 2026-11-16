import { readFileSync } from "node:fs";
import { minimatch } from "minimatch";
import type {
  CoverageDisposition,
  CoverageScope,
  DiffLines,
  LcovData,
  MissingCoverageResult,
  CoverageRule,
} from "./types.mts";
import { matchRule } from "./rules.mts";
import { executableLineNumbers } from "./source-executable-lines.mts";
export { executableLineNumbers } from "./source-executable-lines.mts";

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true }));
}

export function normalizeCoveragePath(value: string): string {
  return value
    .replace(/^file:\/\//, "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
}

export function coverageDisposition(value: string, scope: CoverageScope): CoverageDisposition {
  const path = normalizeCoveragePath(value);
  if (!matchesAny(path, scope.include) || matchesAny(path, scope.ignored ?? [])) return "ignored";
  return matchesAny(path, scope.supplemental ?? []) ? "supplemental" : "aggregate";
}

export function findMissingCoverage(
  diff: DiffLines,
  lcov: LcovData,
  rules: CoverageRule[],
  scope: CoverageScope,
  readSource: (path: string) => string = (path) => readFileSync(path, "utf8"),
): MissingCoverageResult[] {
  const missing: MissingCoverageResult[] = [];
  for (const [file, changedLines] of diff) {
    if (lcov.has(file) || coverageDisposition(file, scope) === "ignored") continue;
    const rule = matchRule(file, rules);
    if (rule === null || rule.patch_coverage_min <= 0) continue;
    let executable: Set<number>;
    try {
      executable = executableLineNumbers(readSource(file), file);
    } catch (error) {
      throw new Error(`failed to analyze coverage scope for ${file}: ${String(error)}`);
    }
    const lines = [...changedLines].filter((line) => executable.has(line)).sort((a, b) => a - b);
    if (lines.length > 0) missing.push({ file, lines, rule: rule.paths });
  }
  return missing;
}

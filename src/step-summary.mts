import { appendFileSync } from "node:fs";
import type { LcovData } from "./types.mts";
import type { CoverageCheckResult } from "./types.mts";

export type SuiteSource = {
  suite: string;
  source: "fresh" | "store";
  lcov: LcovData;
};

function suiteTotals(lcov: LcovData): { hit: number; total: number } {
  let hit = 0;
  let total = 0;
  for (const lines of lcov.values()) {
    for (const count of lines.values()) {
      total++;
      if (count > 0) hit++;
    }
  }
  return { hit, total };
}

function pctStr(hit: number, total: number): string {
  if (total === 0) return "—";
  return `${((hit / total) * 100).toFixed(1)}% (${hit}/${total})`;
}

function escMd(s: string): string {
  return s.replace(/\|/g, "\\|");
}

export function buildSummaryMarkdown(
  suiteSources: SuiteSource[],
  result: CoverageCheckResult,
  runUrl: string,
  branch = "main",
): string {
  const suiteRows = suiteSources
    .map(({ suite, source, lcov }) => {
      const { hit, total } = suiteTotals(lcov);
      const sourceLabel = source === "fresh" ? "fresh" : `store (${escMd(branch)})`;
      return `| \`${escMd(suite)}\` | ${sourceLabel} | ${pctStr(hit, total)} |`;
    })
    .join("\n");

  const suiteTable = [
    "| Suite | Source | Line coverage |",
    "|---|---|---|",
    suiteRows || "| — | — | — |",
  ].join("\n");

  const ruleRows = result.buckets
    .map((b) => {
      const status = b.passed ? "✅" : "❌";
      const pct = b.coverable > 0 ? `${((b.hit / b.coverable) * 100).toFixed(1)}%` : "—";
      return `| \`${escMd(b.rule)}\` | ${b.threshold}% | ${pct} | ${status} |`;
    })
    .join("\n");

  const ruleTable = [
    "| Rule | Threshold | Patch coverage | Status |",
    "|---|---|---|---|",
    ruleRows || "| — | — | — | — |",
  ].join("\n");

  const overall = result.passed ? "✅ passed" : "❌ failed";
  const runLink = runUrl !== "N/A" ? `\n\n_[View run](${runUrl})_` : "";

  return `## Coverage summary — ${overall}

### Suite totals

${suiteTable}

### Patch coverage

${ruleTable}${runLink}
`;
}

export function writeSummary(
  summaryFile: string,
  suiteSources: SuiteSource[],
  result: CoverageCheckResult,
  runUrl: string,
  branch?: string,
): void {
  appendFileSync(summaryFile, buildSummaryMarkdown(suiteSources, result, runUrl, branch), "utf8");
}

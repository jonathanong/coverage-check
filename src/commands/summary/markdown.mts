import type { CoverageSummary, CoverageTotals, SourceCoverageGroup } from "./types.mts";

export function suiteTotals(suite: { lcov: Map<string, Map<number, number>> }): CoverageTotals {
  let hit = 0;
  let total = 0;

  for (const lines of suite.lcov.values()) {
    for (const count of lines.values()) {
      total++;
      if (count > 0) hit++;
    }
  }

  return { hit, total };
}

function pct(hit: number, total: number): string {
  if (total === 0) return "--";
  return `${((hit / total) * 100).toFixed(1)}% (${hit}/${total})`;
}

function escMd(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function codeSpan(value: string): string {
  const escaped = escMd(value);
  const longestRun = Math.max(
    0,
    ...Array.from(escaped.matchAll(/`+/g), (match) => match[0].length),
  );
  if (longestRun === 0) return `\`${escaped}\``;
  const ticks = "`".repeat(longestRun + 1);
  return `${ticks} ${escaped} ${ticks}`;
}

function groupRow(group: SourceCoverageGroup, branch: string): string {
  const source =
    group.source === "current"
      ? "current run"
      : group.source === "history"
        ? `history (${escMd(group.branchesLabel ?? branch)})`
        : `current run + history (${escMd(group.branchesLabel ?? branch)})`;
  const totals = suiteTotals(group);
  return `| ${codeSpan(group.folder)} | ${source} | ${pct(totals.hit, totals.total)} |`;
}

function s3ConsoleUrl(spec: string): string {
  const slash = spec.indexOf("/");
  const bucket = (slash === -1 ? spec : spec.slice(0, slash)).replace(/^\/+|\/+$/g, "");
  if (slash === -1) return `https://s3.console.aws.amazon.com/s3/buckets/${bucket}`;
  // Optimization: Instead of using split and map which allocates multiple arrays,
  // we can use replace with a regex to encode each segment, but since encodeURIComponent
  // also encodes '/', we just encode the whole string and replace %2F back to /.
  const prefixRaw = spec.slice(slash + 1).replace(/^\/+|\/+$/g, "");
  const prefix = encodeURIComponent(prefixRaw).replace(/%2F/g, "/");
  return `https://s3.console.aws.amazon.com/s3/buckets/${bucket}?prefix=${prefix}/`;
}

export function renderCoverageSummaryMarkdown(
  summary: CoverageSummary,
  branch: string,
  storeS3: string | null = null,
): string {
  const rows =
    summary.groups.length === 0
      ? "| -- | -- | -- |"
      : summary.groups.map((group) => groupRow(group, branch)).join("\n");
  const warnings =
    summary.warnings.length === 0
      ? ""
      : `\n\n${summary.warnings.map((warning) => `> ${escMd(warning)}`).join("\n")}`;
  const storeLink =
    storeS3 === null
      ? ""
      : `\nCoverage store: [${codeSpan(`s3://${storeS3}`)}](${s3ConsoleUrl(storeS3)})\n`;

  return `## Project coverage summary

Current run line coverage: **${pct(summary.currentTotals.hit, summary.currentTotals.total)}**

Total project line coverage: **${pct(summary.totals.hit, summary.totals.total)}**
${storeLink}
| Source folder | Source | Line coverage |
|---|---|---|
${rows}${warnings}
`;
}

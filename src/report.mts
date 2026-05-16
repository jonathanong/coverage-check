import type { BucketResult, CoverageCheckResult, FileCoverageResult } from "./types.mts";

export const COMMENT_MARKER = "<!-- coverage-check -->";

export function collapseRanges(lines: number[]): string {
  if (lines.length === 0) return "";
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0]!;
  let end = start;

  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n === end + 1) {
      end = n;
    } else {
      ranges.push(start === end ? `L${start}` : `L${start}-${end}`);
      start = n;
      end = n;
    }
  }
  ranges.push(start === end ? `L${start}` : `L${start}-${end}`);
  return ranges.join(", ");
}

function pct(bucket: BucketResult): string {
  if (bucket.coverable === 0) return "—";
  return `${((bucket.hit / bucket.coverable) * 100).toFixed(1)}% (${bucket.hit}/${bucket.coverable})`;
}

function renderFileList(files: FileCoverageResult[]): string {
  return files
    .filter((f) => f.uncoveredLines.length > 0)
    .map((f) => `- \`${f.file}\`: ${collapseRanges(f.uncoveredLines)}`)
    .join("\n");
}

export function renderFailureComment(
  result: CoverageCheckResult,
  runUrl: string,
  now: string = new Date().toISOString(),
): string {
  const failingBuckets = result.buckets.filter((b) => !b.passed);
  const table = [
    "| Workspace rule | Patch coverage | Threshold |",
    "|---|---|---|",
    ...failingBuckets.map((b) => `| \`${b.rule}\` | ${pct(b)} | ${b.threshold}% |`),
  ].join("\n");

  const sections = failingBuckets
    .map((b) => {
      const fileList = renderFileList(b.files);
      return `**\`${b.rule}\`** (threshold ${b.threshold}%):\n${fileList || "_No line-level data available_"}`;
    })
    .join("\n\n");

  const informationalLines = result.informational
    .filter((f) => f.uncoveredLines.length > 0)
    .map((f) => `- \`${f.file}\`: ${collapseRanges(f.uncoveredLines)}`)
    .join("\n");

  const informationalSection =
    informationalLines.length > 0
      ? `\n<details><summary>Informational (no rule)</summary>\n\n${informationalLines}\n</details>`
      : "";

  return `${COMMENT_MARKER}
## Patch coverage gate failed

${table}

### Uncovered lines

${sections}
${informationalSection}

_Last updated: ${now} · [Workflow run](${runUrl})_`;
}

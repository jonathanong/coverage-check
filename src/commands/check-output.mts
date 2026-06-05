import type { DropResult, DiffLines, LcovData } from "../types.mts";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

function fmtPct(n: number | null): string {
  return n === null ? "—" : `${n.toFixed(2)}%`;
}

function fmtDrop(n: number | null): string {
  /* c8 ignore next -- failing drops always have non-null drop (drop===null implies passed===true) */
  return n === null ? "—" : `${n.toFixed(2)}pp`;
}

function lcovContributesToDiff(sourceLcov: LcovData, diff: DiffLines): boolean {
  for (const [file, changedLines] of diff) {
    const fileLines = sourceLcov.get(file);
    if (fileLines) {
      for (const lineNo of changedLines) {
        if (fileLines.has(lineNo)) return true;
      }
    }
  }
  return false;
}

export function warnNonContributing(
  parsedSources: { name: string; lcov: LcovData }[],
  diff: DiffLines,
): void {
  if (diff.size === 0) return;
  for (const { name, lcov: sourceLcov } of parsedSources) {
    if (!lcovContributesToDiff(sourceLcov, diff)) {
      stderr(
        `coverage-check: warning: coverage from ${name} contributed 0 coverable lines to the patch result. This may indicate a path prefix mismatch.`,
      );
    }
  }
}

export function printDropOutput(drops: DropResult[]): void {
  if (drops.length === 0) return;

  const skippedDrops = drops.filter((d) => d.skipped);
  const failingDrops = drops.filter((d) => !d.passed && !d.skipped);
  const passingDrops = drops.filter((d) => d.passed && !d.skipped);

  if (skippedDrops.length > 0) {
    stdout("\ncoverage-check: coverage drop check skipped (no baseline)\n");
    for (const d of skippedDrops) {
      stdout(`  ${d.rule}: no baseline available`);
    }
  }
  if (failingDrops.length > 0) {
    stdout("\ncoverage-check: COVERAGE REGRESSION\n");
    for (const d of failingDrops) {
      stdout(
        `  ${d.rule}: ${fmtPct(d.currentPct)} (was ${fmtPct(d.baselinePct)}, dropped ${fmtDrop(d.drop)}, max allowed ${d.maxDrop}pp)`,
      );
    }
  }
  if (passingDrops.length > 0) {
    for (const d of passingDrops) {
      stdout(`  ${d.rule}: ${fmtPct(d.currentPct)} (baseline ${fmtPct(d.baselinePct)}) ✓`);
    }
  }
}

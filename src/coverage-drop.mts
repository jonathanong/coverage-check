import type { CoverageRule, DropResult, LcovData } from "./types.mts";
import { matchRule } from "./rules.mts";

function fileTotals(
  lcov: LcovData,
  rulePaths: string,
  allRules: CoverageRule[],
): { hit: number; total: number } {
  let hit = 0;
  let total = 0;
  for (const [file, lines] of lcov) {
    const matched = matchRule(file, allRules);
    if (matched?.paths !== rulePaths) continue;
    for (const count of lines.values()) {
      total++;
      if (count > 0) hit++;
    }
  }
  return { hit, total };
}

export function computeCoverageDrop(
  current: LcovData,
  baseline: LcovData | null,
  rules: CoverageRule[],
): DropResult[] {
  const dropRules = rules.filter((r) => r.no_coverage_drop);
  return dropRules.map((rule) => {
    const maxDrop = rule.max_coverage_drop ?? 0;
    if (baseline === null) {
      return {
        rule: rule.paths,
        currentPct: null,
        baselinePct: null,
        drop: null,
        maxDrop,
        passed: true,
        skipped: true,
      };
    }
    const cur = fileTotals(current, rule.paths, rules);
    const base = fileTotals(baseline, rule.paths, rules);
    const currentPct = cur.total === 0 ? null : (cur.hit / cur.total) * 100;
    const baselinePct = base.total === 0 ? null : (base.hit / base.total) * 100;
    const drop = currentPct !== null && baselinePct !== null ? baselinePct - currentPct : null;
    const passed = drop === null || drop <= maxDrop + 1e-9;
    return { rule: rule.paths, currentPct, baselinePct, drop, maxDrop, passed, skipped: false };
  });
}

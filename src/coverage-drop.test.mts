import { describe, expect, it } from "vitest";
import { computeCoverageDrop } from "./coverage-drop.mts";
import type { CoverageRule, LcovData } from "./types.mts";

function makeLcov(files: Record<string, Record<number, number>>): LcovData {
  const lcov: LcovData = new Map();
  for (const [file, lines] of Object.entries(files)) {
    lcov.set(file, new Map(Object.entries(lines).map(([l, h]) => [Number(l), h])));
  }
  return lcov;
}

describe("computeCoverageDrop", () => {
  const rules: CoverageRule[] = [
    { paths: "backend/scripts/**", patch_coverage_min: 0 },
    { paths: "backend/**", patch_coverage_min: 95, no_coverage_drop: true },
    { paths: "web/**", patch_coverage_min: 80, no_coverage_drop: true, max_coverage_drop: 1 },
    { paths: "cloudflare-worker/**", patch_coverage_min: 100 }, // no no_coverage_drop
  ];

  it("skips all rules when baseline is null", () => {
    const current = makeLcov({ "backend/index.ts": { 1: 1, 2: 0 } });
    const drops = computeCoverageDrop(current, null, rules);
    expect(drops).toHaveLength(2); // backend/** and web/**
    for (const d of drops) {
      expect(d.skipped).toBe(true);
      expect(d.passed).toBe(true);
      expect(d.currentPct).toBeNull();
      expect(d.baselinePct).toBeNull();
      expect(d.drop).toBeNull();
    }
  });

  it("passes when current equals baseline", () => {
    const lcov = makeLcov({ "backend/index.ts": { 1: 1, 2: 1 } });
    const drops = computeCoverageDrop(lcov, lcov, rules);
    const backendDrop = drops.find((d) => d.rule === "backend/**")!;
    expect(backendDrop.passed).toBe(true);
    expect(backendDrop.drop).toBe(0);
  });

  it("passes when current is higher than baseline (improvement)", () => {
    const baseline = makeLcov({ "backend/index.ts": { 1: 1, 2: 0 } }); // 50%
    const current = makeLcov({ "backend/index.ts": { 1: 1, 2: 1 } }); // 100%
    const drops = computeCoverageDrop(current, baseline, rules);
    const d = drops.find((d) => d.rule === "backend/**")!;
    expect(d.passed).toBe(true);
    expect(d.drop).toBeLessThanOrEqual(0);
  });

  it("fails when coverage drops and exceeds maxDrop", () => {
    const baseline = makeLcov({ "backend/index.ts": { 1: 1, 2: 1, 3: 1, 4: 1 } }); // 100%
    const current = makeLcov({ "backend/index.ts": { 1: 1, 2: 0, 3: 0, 4: 0 } }); // 25%
    const drops = computeCoverageDrop(current, baseline, rules);
    const d = drops.find((d) => d.rule === "backend/**")!;
    expect(d.passed).toBe(false);
    expect(d.skipped).toBe(false);
    expect(d.drop).toBeCloseTo(75, 5);
  });

  it("passes when drop is within max_coverage_drop tolerance", () => {
    // 99/100 = 99%, baseline 100%, drop exactly 1pp = maxDrop for web/**
    const currentLines: Record<number, number> = {};
    for (let i = 1; i <= 100; i++) currentLines[i] = i === 1 ? 0 : 1; // 99/100 hit
    const baselineLines: Record<number, number> = {};
    for (let i = 1; i <= 100; i++) baselineLines[i] = 1; // 100/100
    const current = makeLcov({ "web/index.ts": currentLines });
    const baseline = makeLcov({ "web/index.ts": baselineLines });
    const drops = computeCoverageDrop(current, baseline, rules);
    const d = drops.find((d) => d.rule === "web/**")!;
    expect(d.drop).toBeCloseTo(1, 5); // exactly 1pp drop
    expect(d.maxDrop).toBe(1);
    expect(d.passed).toBe(true); // 1 <= 1
  });

  it("only aggregates files matching the specific rule (first-match-wins)", () => {
    // backend/scripts/** files should NOT be counted toward backend/**
    const lcov = makeLcov({
      "backend/scripts/migrate.ts": { 1: 0, 2: 0, 3: 0 }, // 0% — but matched by backend/scripts/**
      "backend/index.ts": { 1: 1, 2: 1 }, // 100%
    });
    const drops = computeCoverageDrop(lcov, lcov, rules);
    const d = drops.find((d) => d.rule === "backend/**")!;
    // backend/scripts/** files are excluded, only backend/index.ts counts
    expect(d.currentPct).toBeCloseTo(100, 5);
  });

  it("handles null currentPct when no files match (total=0)", () => {
    const current = makeLcov({}); // empty
    const baseline = makeLcov({ "backend/index.ts": { 1: 1 } });
    const drops = computeCoverageDrop(current, baseline, rules);
    const d = drops.find((d) => d.rule === "backend/**")!;
    expect(d.currentPct).toBeNull();
    expect(d.drop).toBeNull();
    expect(d.passed).toBe(true); // null drop → passed
  });

  it("handles null baselinePct when baseline has no matching files (total=0)", () => {
    const current = makeLcov({ "backend/index.ts": { 1: 1 } });
    const baseline = makeLcov({}); // empty baseline
    const drops = computeCoverageDrop(current, baseline, rules);
    const d = drops.find((d) => d.rule === "backend/**")!;
    expect(d.baselinePct).toBeNull();
    expect(d.drop).toBeNull();
    expect(d.passed).toBe(true);
  });

  it("returns empty array when no rules have no_coverage_drop", () => {
    const rulesNoDrop: CoverageRule[] = [{ paths: "backend/**", patch_coverage_min: 95 }];
    const lcov = makeLcov({ "backend/index.ts": { 1: 1 } });
    expect(computeCoverageDrop(lcov, lcov, rulesNoDrop)).toEqual([]);
  });

  describe("changedRules parameter", () => {
    it("skips rules not in changedRules even when baseline is available", () => {
      const baseline = makeLcov({ "backend/index.ts": { 1: 1, 2: 1 } }); // 100%
      const current = makeLcov({ "backend/index.ts": { 1: 1, 2: 0 } }); // 50% — regression!
      const backendRule = rules.find((r) => r.paths === "backend/**")!;
      // changedRules contains only web/** — backend/** not in set → skip
      const webRule = rules.find((r) => r.paths === "web/**")!;
      const changedRules = new Set([webRule]);
      const drops = computeCoverageDrop(current, baseline, rules, changedRules);
      const d = drops.find((d) => d.rule === "backend/**")!;
      expect(d.skipped).toBe(true);
      expect(d.passed).toBe(true);
      // Verify the skipped rule would have failed without changedRules
      const dropsWithout = computeCoverageDrop(current, baseline, rules);
      const dWithout = dropsWithout.find((d) => d.rule === "backend/**")!;
      expect(dWithout.passed).toBe(false);
      // Suppress unused variable warning
      expect(backendRule).toBeDefined();
    });

    it("evaluates rules in changedRules normally", () => {
      const baseline = makeLcov({ "backend/index.ts": { 1: 1, 2: 1 } }); // 100%
      const current = makeLcov({ "backend/index.ts": { 1: 1, 2: 0 } }); // 50%
      const backendRule = rules.find((r) => r.paths === "backend/**")!;
      const changedRules = new Set([backendRule]);
      const drops = computeCoverageDrop(current, baseline, rules, changedRules);
      const d = drops.find((d) => d.rule === "backend/**")!;
      expect(d.skipped).toBe(false);
      expect(d.passed).toBe(false); // regression is real
    });

    it("skips all drop rules when changedRules is empty", () => {
      const baseline = makeLcov({ "backend/index.ts": { 1: 1, 2: 1 } });
      const current = makeLcov({ "backend/index.ts": { 1: 1, 2: 0 } });
      const changedRules = new Set<CoverageRule>();
      const drops = computeCoverageDrop(current, baseline, rules, changedRules);
      expect(drops.every((d) => d.skipped)).toBe(true);
    });

    it("undefined changedRules preserves existing behavior", () => {
      const baseline = makeLcov({ "backend/index.ts": { 1: 1, 2: 1, 3: 1, 4: 1 } });
      const current = makeLcov({ "backend/index.ts": { 1: 1, 2: 0, 3: 0, 4: 0 } });
      const drops = computeCoverageDrop(current, baseline, rules);
      const d = drops.find((d) => d.rule === "backend/**")!;
      expect(d.passed).toBe(false);
      expect(d.skipped).toBe(false);
    });
  });
});

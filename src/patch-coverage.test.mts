import { describe, expect, it } from "vitest";
import { parseLcov } from "./lcov-parser.mts";
import { parseDiff } from "./diff-parser.mts";
import { computePatchCoverage } from "./patch-coverage.mts";
import type { CoverageRule } from "./types.mts";

const rules: CoverageRule[] = [
  { paths: "backend/**", patch_coverage_min: 90 },
  { paths: "web/**", patch_coverage_min: 5 },
];

describe("computePatchCoverage", () => {
  it("passes when all changed lines are covered", () => {
    const lcov = parseLcov(`SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n`);
    const diff: ReturnType<typeof parseDiff> = new Map([["backend/foo.mts", new Set([1, 2])]]);
    const { buckets } = computePatchCoverage(diff, lcov, rules);
    const bucket = buckets.find((b) => b.rule === "backend/**")!;
    expect(bucket.passed).toBe(true);
    expect(bucket.hit).toBe(2);
    expect(bucket.coverable).toBe(2);
  });

  it("fails when coverage drops below threshold", () => {
    const lcov = parseLcov(
      `SF:backend/foo.mts\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nDA:5,1\nDA:6,1\nDA:7,1\nDA:8,1\nDA:9,0\nDA:10,0\nend_of_record\n`,
    );
    const diff: ReturnType<typeof parseDiff> = new Map([
      ["backend/foo.mts", new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
    ]);
    const { buckets } = computePatchCoverage(diff, lcov, rules);
    const bucket = buckets.find((b) => b.rule === "backend/**")!;
    expect(bucket.passed).toBe(false);
    expect(bucket.hit).toBe(8);
    expect(bucket.coverable).toBe(10);
  });

  it("passes vacuously when no coverable changed lines", () => {
    const lcov = parseLcov(`SF:backend/foo.mts\nDA:1,1\nend_of_record\n`);
    const diff: ReturnType<typeof parseDiff> = new Map([["backend/foo.mts", new Set([99])]]);
    const { buckets } = computePatchCoverage(diff, lcov, rules);
    const bucket = buckets.find((b) => b.rule === "backend/**");
    expect(!bucket || bucket.passed).toBe(true);
  });

  it("skips files not in lcov", () => {
    const lcov = parseLcov(`SF:backend/other.mts\nDA:1,1\nend_of_record\n`);
    const diff: ReturnType<typeof parseDiff> = new Map([
      ["backend/missing.mts", new Set([1, 2, 3])],
    ]);
    const { buckets, informational } = computePatchCoverage(diff, lcov, rules);
    expect(buckets).toHaveLength(0);
    expect(informational).toHaveLength(0);
  });

  it("fails closed for executable changed lines missing a genuine LCOV record", () => {
    const diff: ReturnType<typeof parseDiff> = new Map([["backend/missing.ts", new Set([1, 2])]]);
    const result = computePatchCoverage(
      diff,
      new Map(),
      rules,
      { version: 1, analyzer: "javascript", include: ["backend/**"] },
      () => "export const value = 1;\n",
    );
    expect(result.missingCoverage).toEqual([
      { file: "backend/missing.ts", lines: [1], rule: "backend/**" },
    ]);
  });

  it("does not require coverage for type-only changed lines", () => {
    const diff: ReturnType<typeof parseDiff> = new Map([["backend/types.ts", new Set([1])]]);
    const result = computePatchCoverage(
      diff,
      new Map(),
      rules,
      { version: 1, analyzer: "javascript", include: ["backend/**"] },
      () => "export type Value = string;\n",
    );
    expect(result.missingCoverage).toEqual([]);
  });

  it("routes unmatched files to informational", () => {
    const lcov = parseLcov(`SF:scripts/ci.mts\nDA:1,0\nend_of_record\n`);
    const diff: ReturnType<typeof parseDiff> = new Map([["scripts/ci.mts", new Set([1])]]);
    const { buckets, informational } = computePatchCoverage(diff, lcov, rules);
    expect(buckets).toHaveLength(0);
    expect(informational).toHaveLength(1);
    expect(informational[0]?.file).toBe("scripts/ci.mts");
  });

  it("accumulates multiple files into the same bucket", () => {
    // Two backend files → both go into the 'backend/**' bucket
    const lcov = parseLcov(
      `SF:backend/a.mts\nDA:1,1\nDA:2,1\nend_of_record\nSF:backend/b.mts\nDA:10,0\nDA:11,0\nend_of_record\n`,
    );
    const diff: ReturnType<typeof parseDiff> = new Map([
      ["backend/a.mts", new Set([1, 2])],
      ["backend/b.mts", new Set([10, 11])],
    ]);
    const { buckets } = computePatchCoverage(diff, lcov, rules);
    const bucket = buckets.find((b) => b.rule === "backend/**")!;
    expect(bucket.coverable).toBe(4);
    expect(bucket.hit).toBe(2);
    expect(bucket.files).toHaveLength(2);
  });

  it("reports uncovered lines correctly", () => {
    const lcov = parseLcov(
      `SF:backend/svc.mts\nDA:10,1\nDA:11,0\nDA:12,0\nDA:13,1\nend_of_record\n`,
    );
    const diff: ReturnType<typeof parseDiff> = new Map([
      ["backend/svc.mts", new Set([10, 11, 12, 13])],
    ]);
    const { buckets } = computePatchCoverage(diff, lcov, rules);
    const file = buckets[0]?.files[0]!;
    expect(file.uncoveredLines).toEqual([11, 12]);
  });
});

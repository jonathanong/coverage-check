import { describe, expect, it } from "vitest";
import { parseLcov } from "./lcov-parser.mts";
import { mergeLcov } from "./lcov-merge.mts";
import { computePatchCoverage } from "./patch-coverage.mts";
import { changedLinesDigest, projectPatchLcov } from "./patch-contribution.mts";

describe("patch LCOV contributions", () => {
  it("preserves the full-report patch result across overlapping shards and zero hits", () => {
    const changed = new Map([["src/renamed file.mts", new Set([1, 2, 4])]]);
    const first = "SF:src/renamed file.mts\nDA:1,0\nDA:2,1\nDA:3,8\nend_of_record\n";
    const second = "SF:src/renamed file.mts\nDA:1,2\nDA:2,0\nDA:4,0\nend_of_record\n";
    const full = computePatchCoverage(changed, mergeLcov([parseLcov(first), parseLcov(second)]), [
      { paths: "src/**", patch_coverage_min: 0 },
    ]);
    const sparse = computePatchCoverage(
      changed,
      mergeLcov([
        parseLcov(projectPatchLcov(first, changed)),
        parseLcov(projectPatchLcov(second, changed)),
      ]),
      [{ paths: "src/**", patch_coverage_min: 0 }],
    );
    expect(sparse).toEqual(full);
  });

  it("keeps an empty changed-file SF record and produces deterministic patch identity", () => {
    const changed = new Map([["src/a.mts", new Set([9])]]);
    expect(projectPatchLcov("SF:src/a.mts\nDA:1,1\nend_of_record\n", changed)).toBe(
      "SF:src/a.mts\nend_of_record\n",
    );
    expect(changedLinesDigest(changed)).toBe(
      changedLinesDigest(new Map([["src/a.mts", new Set([9])]])),
    );
  });

  it("supports empty patch contributions and representative LCOV record forms", () => {
    const changed = new Map([["swift/App.swift", new Set([4])]]);
    expect(
      projectPatchLcov("TN:coverlet\nSF:dotnet/App.cs\nDA:2,1\nend_of_record\n", changed),
    ).toBe("");
    expect(
      projectPatchLcov("TN:llvm\nSF:swift/App.swift\nFN:4,work\nDA:4,1\nend_of_record\n", changed),
    ).toContain("DA:4,1");
  });
});

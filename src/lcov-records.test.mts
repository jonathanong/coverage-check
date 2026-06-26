import { describe, expect, it } from "vitest";
import { parseLcovFull, mergeLcovFull, toLcovFull } from "./lcov-records.mts";
import type { FullLcovData } from "./lcov-records.mts";

const SAMPLE_LCOV = `
TN:
SF:src/foo.mts
FN:5,foo
FNDA:3,foo
FNF:1
FNH:1
BRDA:7,0,0,2
BRDA:7,0,1,0
BRF:2
BRH:1
DA:5,3
DA:6,1
DA:7,3
DA:8,0
LF:4
LH:3
end_of_record
TN:
SF:src/bar.mts
FN:1,bar
FNDA:0,bar
FNF:1
FNH:0
DA:1,0
LF:1
LH:0
end_of_record
`;

describe("parseLcovFull", () => {
  it("parses FN, FNDA, BRDA, and DA records", () => {
    const result = parseLcovFull(SAMPLE_LCOV);
    const foo = result.get("src/foo.mts")!;
    expect(foo).toBeDefined();
    expect(foo.functions.get("foo")).toEqual({ line: 5, name: "foo" });
    expect(foo.functionHits.get("foo")).toBe(3);
    expect(foo.branches.get("7,0,0")).toBe(2);
    expect(foo.branches.get("7,0,1")).toBe(0);
    expect(foo.lines.get(5)).toBe(3);
    expect(foo.lines.get(8)).toBe(0);
  });

  it("parses both files", () => {
    const result = parseLcovFull(SAMPLE_LCOV);
    expect(result.size).toBe(2);
    const bar = result.get("src/bar.mts")!;
    expect(bar.functionHits.get("bar")).toBe(0);
    expect(bar.lines.get(1)).toBe(0);
  });

  it("strips provided prefix from SF: paths", () => {
    const lcov = `SF:/home/runner/work/repo/repo/src/foo.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcovFull(lcov, ["/home/runner/work/repo/repo/"]);
    expect(result.has("src/foo.mts")).toBe(true);
  });

  it("auto-strips GitHub Actions _work path", () => {
    const lcov = `SF:/home/runner/work/myapp/myapp/lib/util.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcovFull(lcov);
    expect(result.has("lib/util.mts")).toBe(true);
  });

  it("auto-strips custom _work path", () => {
    const lcov = `SF:/mnt/runner/_work/proj/proj/src/index.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcovFull(lcov);
    expect(result.has("src/index.mts")).toBe(true);
  });

  it("preserves absolute paths that do not match the _work pattern", () => {
    // e.g. /usr/local/lib/foo.mts — starts with "/" but no _work segment
    const lcov = `SF:/usr/local/lib/foo.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcovFull(lcov);
    expect(result.has("/usr/local/lib/foo.mts")).toBe(true);
  });

  it("treats BRDA '-' hits as 0", () => {
    const lcov = `SF:src/x.mts\nBRDA:1,0,0,-\nend_of_record\n`;
    const result = parseLcovFull(lcov);
    expect(result.get("src/x.mts")!.branches.get("1,0,0")).toBe(0);
  });

  it("sums hits from duplicate DA records for the same line", () => {
    const lcov = `SF:src/x.mts\nDA:1,2\nDA:1,3\nend_of_record\n`;
    const result = parseLcovFull(lcov);
    expect(result.get("src/x.mts")!.lines.get(1)).toBe(5);
  });

  it("sums hits from duplicate FNDA records for the same name", () => {
    const lcov = `SF:src/x.mts\nFN:1,fn\nFNDA:4,fn\nFNDA:2,fn\nend_of_record\n`;
    const result = parseLcovFull(lcov);
    expect(result.get("src/x.mts")!.functionHits.get("fn")).toBe(6);
  });

  it("skips summary lines LF/LH/FNF/FNH/BRF/BRH without error", () => {
    const result = parseLcovFull(SAMPLE_LCOV);
    expect(result.has("src/foo.mts")).toBe(true);
    expect(result.get("src/foo.mts")!.lines.get(5)).toBe(3);
  });

  it("handles empty LCOV text", () => {
    expect(parseLcovFull("").size).toBe(0);
  });

  it("ignores records outside SF/end_of_record blocks", () => {
    const lcov = `DA:1,1\nFN:5,orphan\nSF:src/x.mts\nDA:2,1\nend_of_record\n`;
    const result = parseLcovFull(lcov);
    expect(result.size).toBe(1);
    expect(result.get("src/x.mts")!.lines.get(1)).toBeUndefined();
    expect(result.get("src/x.mts")!.lines.get(2)).toBe(1);
  });

  it("normalizes Windows backslash paths", () => {
    const lcov = `SF:.\\backend\\index.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcovFull(lcov);
    expect(result.has("backend/index.mts")).toBe(true);
  });

  it("strips trailing whitespace and CR from lines", () => {
    // Lines with trailing spaces/tabs/CR — exercises the lineEnd trimming loop
    const lcov = "SF:src/x.mts  \r\nDA:1,1   \r\nend_of_record\r\n";
    const result = parseLcovFull(lcov);
    expect(result.has("src/x.mts")).toBe(true);
    expect(result.get("src/x.mts")!.lines.get(1)).toBe(1);
  });

  it("handles LCOV text with no trailing newline", () => {
    // The last line has no newline: indexOf("\n") returns -1, so end = text.length
    const lcov = "SF:src/x.mts\nDA:1,1\nend_of_record";
    const result = parseLcovFull(lcov);
    expect(result.has("src/x.mts")).toBe(true);
    expect(result.get("src/x.mts")!.lines.get(1)).toBe(1);
  });

  it("silently skips malformed FN, FNDA, BRDA, and DA records", () => {
    // Exercises the guard return/skip branches for malformed lines:
    //   FN without comma → early return (line 43)
    //   FN with non-numeric lineNum → Number.isFinite false (line 46)
    //   FNDA without comma → early return (line 49)
    //   FNDA with non-numeric hits → Number.isFinite false (line 52)
    //   BRDA with wrong part count → early return (line 56)
    //   BRDA with non-numeric, non-"-" hits → Number.isFinite false (line 60)
    //   DA without comma → early return (line 63)
    //   DA with non-numeric lineNum → Number.isFinite false (line 66)
    const lcov = [
      "SF:src/x.mts",
      "FN:nocomma", // no comma → return early
      "FN:abc,fn", // lineNum is NaN → isFinite false → skip
      "FNDA:nohits", // no comma → return early
      "FNDA:abc,fn", // hits is NaN → isFinite false → skip
      "BRDA:1", // only 1 part (need 4) → return early
      "BRDA:1,2", // only 2 parts (need 4) → return early
      "BRDA:1,2,3", // only 3 parts (need 4) → return early
      "BRDA:1,2,3,4,5", // 5 parts (need 4) → return early
      "BRDA:1,0,0,abc", // hits is not "-" and not a number → NaN → skip
      "DA:noline", // no comma → return early
      "DA:abc,1", // lineNum is NaN → isFinite false → skip
      "DA:1,1", // valid — should be recorded
      "end_of_record",
    ].join("\n");
    const result = parseLcovFull(lcov);
    const cov = result.get("src/x.mts")!;
    expect(cov).toBeDefined();
    // Only the valid DA:1,1 should be recorded
    expect(cov.lines.get(1)).toBe(1);
    expect(cov.lines.size).toBe(1);
    expect(cov.functionHits.size).toBe(0);
    expect(cov.branches.size).toBe(0);
  });

  it("handles duplicate SF blocks for the same file by merging them", () => {
    // Two SF:src/x.mts blocks in one LCOV — exercises the getOrCreate false branch
    // (file already exists in map → return existing cov without creating new one)
    const lcov = "SF:src/x.mts\nDA:1,1\nend_of_record\n" + "SF:src/x.mts\nDA:2,1\nend_of_record\n";
    const result = parseLcovFull(lcov);
    expect(result.size).toBe(1);
    const cov = result.get("src/x.mts")!;
    expect(cov.lines.get(1)).toBe(1);
    expect(cov.lines.get(2)).toBe(1);
  });
});

describe("mergeLcovFull", () => {
  it("sums line hits across reports", () => {
    const a = parseLcovFull(`SF:src/foo.mts\nDA:1,3\nDA:2,0\nend_of_record\n`);
    const b = parseLcovFull(`SF:src/foo.mts\nDA:1,2\nDA:2,1\nend_of_record\n`);
    const merged = mergeLcovFull([a, b]);
    const cov = merged.get("src/foo.mts")!;
    expect(cov.lines.get(1)).toBe(5);
    expect(cov.lines.get(2)).toBe(1);
  });

  it("sums function hit counts", () => {
    const a = parseLcovFull(`SF:src/foo.mts\nFN:1,fn1\nFNDA:4,fn1\nend_of_record\n`);
    const b = parseLcovFull(`SF:src/foo.mts\nFN:1,fn1\nFNDA:2,fn1\nend_of_record\n`);
    const merged = mergeLcovFull([a, b]);
    expect(merged.get("src/foo.mts")!.functionHits.get("fn1")).toBe(6);
  });

  it("sums branch hit counts", () => {
    const a = parseLcovFull(`SF:src/foo.mts\nBRDA:5,0,0,3\nend_of_record\n`);
    const b = parseLcovFull(`SF:src/foo.mts\nBRDA:5,0,0,2\nend_of_record\n`);
    const merged = mergeLcovFull([a, b]);
    expect(merged.get("src/foo.mts")!.branches.get("5,0,0")).toBe(5);
  });

  it("merges files from different reports", () => {
    const a = parseLcovFull(`SF:src/foo.mts\nDA:1,1\nend_of_record\n`);
    const b = parseLcovFull(`SF:src/bar.mts\nDA:1,1\nend_of_record\n`);
    const merged = mergeLcovFull([a, b]);
    expect(merged.has("src/foo.mts")).toBe(true);
    expect(merged.has("src/bar.mts")).toBe(true);
  });

  it("returns empty FullLcovData for empty input", () => {
    expect(mergeLcovFull([])).toEqual(new Map());
  });

  it("keeps first-seen function definition when merging", () => {
    const a = parseLcovFull(`SF:src/foo.mts\nFN:10,fn\nend_of_record\n`);
    const b = parseLcovFull(`SF:src/foo.mts\nFN:20,fn\nend_of_record\n`);
    const merged = mergeLcovFull([a, b]);
    expect(merged.get("src/foo.mts")!.functions.get("fn")?.line).toBe(10);
  });

  it("adds function definition and hit count when second report has a function not in first", () => {
    // Covers: !target.functions.has(name) → true; target.functionHits.get(name) ?? 0 fallback
    const a = parseLcovFull(`SF:src/foo.mts\nFN:1,fnA\nFNDA:5,fnA\nend_of_record\n`);
    const b = parseLcovFull(
      `SF:src/foo.mts\nFN:1,fnA\nFNDA:2,fnA\nFN:2,fnB\nFNDA:3,fnB\nend_of_record\n`,
    );
    const merged = mergeLcovFull([a, b]);
    const cov = merged.get("src/foo.mts")!;
    // fnB is in b but not a; functions.set should be called and ?? 0 fallback taken for functionHits
    expect(cov.functions.get("fnB")).toEqual({ line: 2, name: "fnB" });
    expect(cov.functionHits.get("fnB")).toBe(3); // 0 (not in a) + 3 = 3
    expect(cov.functionHits.get("fnA")).toBe(7); // 5 + 2
  });

  it("adds branch hit count when second report has a branch key not in first", () => {
    // Covers: target.branches.get(key) ?? 0 fallback when key is absent
    const a = parseLcovFull(`SF:src/foo.mts\nBRDA:1,0,0,4\nend_of_record\n`);
    const b = parseLcovFull(`SF:src/foo.mts\nBRDA:1,0,0,2\nBRDA:1,0,1,3\nend_of_record\n`);
    const merged = mergeLcovFull([a, b]);
    const cov = merged.get("src/foo.mts")!;
    expect(cov.branches.get("1,0,0")).toBe(6); // 4 + 2
    expect(cov.branches.get("1,0,1")).toBe(3); // 0 (not in a) + 3
  });
});

describe("toLcovFull", () => {
  it("emits SF, FN, FNDA, FNF, FNH, BRDA, BRF, BRH, DA, LF, LH, end_of_record", () => {
    const parsed = parseLcovFull(SAMPLE_LCOV);
    const out = toLcovFull(parsed);
    expect(out).toContain("SF:src/foo.mts");
    expect(out).toContain("FN:5,foo");
    expect(out).toContain("FNDA:3,foo");
    expect(out).toContain("FNF:1");
    expect(out).toContain("FNH:1");
    expect(out).toContain("BRDA:7,0,0,2");
    expect(out).toContain("BRDA:7,0,1,0");
    expect(out).toContain("BRF:2");
    expect(out).toContain("BRH:1");
    expect(out).toContain("DA:5,3");
    expect(out).toContain("LF:4");
    expect(out).toContain("LH:3");
    expect(out).toContain("end_of_record");
  });

  it("returns empty string for empty data", () => {
    expect(toLcovFull(new Map() as FullLcovData)).toBe("");
  });

  it("sorts files alphabetically", () => {
    const input = `SF:src/z.mts\nDA:1,1\nend_of_record\nSF:src/a.mts\nDA:1,1\nend_of_record\n`;
    const out = toLcovFull(parseLcovFull(input));
    expect(out.indexOf("src/a.mts")).toBeLessThan(out.indexOf("src/z.mts"));
  });

  it("recomputes LH/LF from actual summed hits", () => {
    const merged = mergeLcovFull([
      parseLcovFull(`SF:src/x.mts\nDA:1,3\nDA:2,0\nend_of_record\n`),
      parseLcovFull(`SF:src/x.mts\nDA:1,2\nend_of_record\n`),
    ]);
    const out = toLcovFull(merged);
    expect(out).toContain("LF:2");
    expect(out).toContain("LH:1");
    expect(out).toContain("DA:1,5");
    expect(out).toContain("DA:2,0");
  });

  it("recomputes FNF/FNH from actual function definitions and hits", () => {
    const parsed = parseLcovFull(
      `SF:src/x.mts\nFN:1,hitFn\nFN:2,missFn\nFNDA:3,hitFn\nFNDA:0,missFn\nend_of_record\n`,
    );
    const out = toLcovFull(parsed);
    expect(out).toContain("FNF:2");
    expect(out).toContain("FNH:1");
  });

  it("recomputes BRF/BRH from actual branch hit counts", () => {
    const parsed = parseLcovFull(`SF:src/x.mts\nBRDA:1,0,0,2\nBRDA:1,0,1,0\nend_of_record\n`);
    const out = toLcovFull(parsed);
    expect(out).toContain("BRF:2");
    expect(out).toContain("BRH:1");
  });

  it("ends with a trailing newline", () => {
    const parsed = parseLcovFull(`SF:src/x.mts\nDA:1,1\nend_of_record\n`);
    const out = toLcovFull(parsed);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("sorts functions by line then by name when lines are equal", () => {
    // Two functions on the same line — secondary sort by name exercises the || branch
    const lcov = `SF:src/x.mts\nFN:5,zebra\nFN:5,alpha\nFNDA:1,zebra\nFNDA:2,alpha\nend_of_record\n`;
    const parsed = parseLcovFull(lcov);
    const out = toLcovFull(parsed);
    const alphaPos = out.indexOf("FN:5,alpha");
    const zebraPos = out.indexOf("FN:5,zebra");
    expect(alphaPos).toBeLessThan(zebraPos);
  });
});

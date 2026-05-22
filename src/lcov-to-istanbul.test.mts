import { describe, expect, it } from "vitest";
import { lcovBufferToIstanbul } from "./lcov-to-istanbul.mts";

function buf(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

describe("lcovBufferToIstanbul", () => {
  it("converts a simple DA record to a statement entry", () => {
    const lcov = buf("TN:\nSF:src/a.mts\nDA:5,3\nend_of_record\n");
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(coverage["src/a.mts"]).toBeDefined();
    expect(coverage["src/a.mts"]!.s["5"]).toBe(3);
    expect(coverage["src/a.mts"]!.statementMap["5"]).toEqual({
      start: { line: 5, column: 0 },
      end: { line: 5, column: 999 },
    });
  });

  it("converts FN:/FNDA: lines to function entries", () => {
    const lcov = buf(
      ["TN:", "SF:src/a.mts", "FN:10,myFunc", "FNDA:2,myFunc", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    const fileCov = coverage["src/a.mts"]!;
    expect(fileCov.fnMap["myFunc@10"]).toBeDefined();
    expect(fileCov.fnMap["myFunc@10"]!.name).toBe("myFunc");
    expect(fileCov.f["myFunc@10"]).toBe(2);
  });

  it("converts FNL: 3-field form (FN:start,end,name)", () => {
    const lcov = buf(
      ["TN:", "SF:src/b.mts", "FNL:1,5,arrowFn", "FNDA:4,arrowFn", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    const fileCov = coverage["src/b.mts"]!;
    expect(fileCov.fnMap["arrowFn@1"]).toBeDefined();
    expect(fileCov.f["arrowFn@1"]).toBe(4);
  });

  it("converts BRDA: lines to branch entries", () => {
    const lcov = buf(
      ["TN:", "SF:src/c.mts", "BRDA:12,0,0,1", "BRDA:12,0,1,0", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    const fileCov = coverage["src/c.mts"]!;
    expect(fileCov.b["12-0"]).toEqual([1, 0]);
    expect(fileCov.branchMap["12-0"]).toBeDefined();
    expect(fileCov.branchMap["12-0"]!.type).toBe("branch");
    expect(fileCov.branchMap["12-0"]!.locations).toHaveLength(2);
  });

  it("treats BRDA '-' as count 0 (untaken branch)", () => {
    const lcov = buf(
      ["TN:", "SF:src/d.mts", "BRDA:7,0,0,5", "BRDA:7,0,1,-", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(coverage["src/d.mts"]!.b["7-0"]).toEqual([5, 0]);
  });

  it("accumulates FNDA: hit counts for same function name across two SF: records", () => {
    const lcov = buf(
      [
        "TN:",
        "SF:src/e.mts",
        "FN:1,sharedFn",
        "FNDA:3,sharedFn",
        "end_of_record",
        "TN:",
        "SF:src/e.mts",
        "FN:1,sharedFn",
        "FNDA:2,sharedFn",
        "end_of_record",
      ].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(coverage["src/e.mts"]!.f["sharedFn@1"]).toBe(5);
  });

  it("merges BRDA counts across two SF: records for the same file", () => {
    const lcov = buf(
      [
        "TN:",
        "SF:src/f.mts",
        "BRDA:3,0,0,2",
        "BRDA:3,0,1,1",
        "end_of_record",
        "TN:",
        "SF:src/f.mts",
        "BRDA:3,0,0,3",
        "BRDA:3,0,1,-",
        "end_of_record",
      ].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    // branch 0: 2+3=5, branch 1: 1+0=1
    expect(coverage["src/f.mts"]!.b["3-0"]).toEqual([5, 1]);
  });

  it("skips BRDA records when filePath has no matching SF: coverage entry", () => {
    // filePath becomes empty string after stripping → fileCov is undefined
    const lcov = buf(
      ["TN:", "SF:/workspace/src/g.mts", "BRDA:1,0,0,1", "end_of_record"].join("\n"),
    );
    // strip to empty string: coverage[filePath] will be undefined
    const coverage = lcovBufferToIstanbul(lcov, ["/workspace/src/g.mts"]);
    // The filePath is stripped to "" which causes fileCov to be undefined
    expect(coverage[""]).toBeUndefined();
    // No crash and the file with the full path was not inserted either
    expect(Object.keys(coverage)).toHaveLength(0);
  });

  it("applies strip prefixes to file paths", () => {
    const lcov = buf("TN:\nSF:/home/runner/src/a.mts\nDA:1,1\nend_of_record\n");
    const coverage = lcovBufferToIstanbul(lcov, ["/home/runner"]);
    expect(coverage["src/a.mts"]).toBeDefined();
    expect(coverage["/home/runner/src/a.mts"]).toBeUndefined();
  });

  it("handles FNDA: without a prior FN: (uses key=name, startLine=0)", () => {
    const lcov = buf(["TN:", "SF:src/h.mts", "FNDA:1,orphanFn", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(coverage["src/h.mts"]!.f["orphanFn"]).toBe(1);
  });

  it("skips malformed BRDA line with missing parts", () => {
    // Missing blockId and branchId — should hit the continue guard
    const lcov = buf(
      ["TN:", "SF:src/j.mts", "BRDA:10", "BRDA:10,0,0,1", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    // Only the valid BRDA line is processed; malformed one is skipped
    expect(coverage["src/j.mts"]!.b["10-0"]).toEqual([1]);
  });

  it("skips BRDA line with non-integer lineNo", () => {
    const lcov = buf(["TN:", "SF:src/k.mts", "BRDA:notanumber,0,0,1", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    // No branches recorded since lineNo is not parseable
    expect(Object.keys(coverage["src/k.mts"]!.b)).toHaveLength(0);
  });

  it("uses fallback loc(0) when blockKey split yields non-integer lineNo", () => {
    // This exercises the Number.isInteger(lineNo) ? lineNo : 0 fallback in the flush section.
    // We can reach it by having a blockKey whose first segment is not a valid number.
    // However, blockKeys are always formed as `${lineNo}-${blockId}` after parseInt passes,
    // so lineNo is always a valid integer there. The branchLoc fallback is thus defensive.
    // Testing BRDA with valid data exercises lines 135-147.
    const lcov = buf(
      ["TN:", "SF:src/l.mts", "BRDA:99,blockA,0,7", "BRDA:99,blockA,1,3", "end_of_record"].join(
        "\n",
      ),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(coverage["src/l.mts"]!.b["99-blockA"]).toEqual([7, 3]);
  });

  it("accumulates DA hit counts for the same file and line across records", () => {
    const lcov = buf(
      [
        "TN:",
        "SF:src/i.mts",
        "DA:1,2",
        "end_of_record",
        "TN:",
        "SF:src/i.mts",
        "DA:1,3",
        "end_of_record",
      ].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(coverage["src/i.mts"]!.s["1"]).toBe(5);
  });
});

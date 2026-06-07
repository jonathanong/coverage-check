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
      [
        "TN:",
        "SF:src/j.mts",
        "BRDA:10",
        "BRDA:10,0",
        "BRDA:10,0,0",
        "BRDA:10,0,0,1",
        "end_of_record",
      ].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    // Only the valid BRDA line is processed; malformed ones are skipped
    expect(coverage["src/j.mts"]!.b["10-0"]).toEqual([1]);
  });

  it("skips BRDA line with non-integer lineNo", () => {
    const lcov = buf(["TN:", "SF:src/k.mts", "BRDA:notanumber,0,0,1", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    // No branches recorded since lineNo is not parseable
    expect(Object.keys(coverage["src/k.mts"]!.b)).toHaveLength(0);
  });

  it("skips BRDA line with empty blockId", () => {
    const lcov = buf(["TN:", "SF:src/k2.mts", "BRDA:10,,0,1", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    // No branches recorded since blockId is empty
    expect(Object.keys(coverage["src/k2.mts"]!.b)).toHaveLength(0);
  });

  it("skips BRDA line with empty branchId", () => {
    const lcov = buf(["TN:", "SF:src/k3.mts", "BRDA:10,0,,1", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    // No branches recorded since branchId is empty
    expect(Object.keys(coverage["src/k3.mts"]!.b)).toHaveLength(0);
  });

  it("skips BRDA line with non-integer hit count", () => {
    const lcov = buf(
      ["TN:", "SF:src/k4.mts", "BRDA:10,0,0,notanumber", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    // No branches recorded since hit count is not parseable and not '-'
    expect(Object.keys(coverage["src/k4.mts"]!.b)).toHaveLength(0);
  });

  it("skips unrecognized line types when inside an SF block", () => {
    const lcov = buf(["TN:", "SF:src/unrecognized.mts", "ZZZ:ignored", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(coverage["src/unrecognized.mts"]?.s).toEqual({});
    expect(coverage["src/unrecognized.mts"]?.fnMap).toEqual({});
    expect(coverage["src/unrecognized.mts"]?.b).toEqual({});
  });

  it("converts BRDA records with numeric blockId to Istanbul branch arrays", () => {
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

  it("skips DA: line with no comma (missing hit count)", () => {
    const lcov = buf(["TN:", "SF:src/da-nocomma.mts", "DA:5", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(Object.keys(coverage["src/da-nocomma.mts"]!.s)).toHaveLength(0);
  });

  it("skips DA: line with non-integer lineNo", () => {
    const lcov = buf(
      ["TN:", "SF:src/da-notanumber.mts", "DA:notanumber,1", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(Object.keys(coverage["src/da-notanumber.mts"]!.s)).toHaveLength(0);
  });

  it("skips DA: line with non-integer hit count", () => {
    const lcov = buf(["TN:", "SF:src/da-badhits.mts", "DA:5,bad", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(Object.keys(coverage["src/da-badhits.mts"]!.s)).toHaveLength(0);
  });

  it("skips FN: line with no comma (malformed)", () => {
    const lcov = buf(["TN:", "SF:src/m.mts", "FN:nocolonhere", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(Object.keys(coverage["src/m.mts"]!.fnMap)).toHaveLength(0);
  });

  it("skips FN: line where start line is not an integer", () => {
    const lcov = buf(["TN:", "SF:src/n.mts", "FN:notanumber,myFunc", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    // The FN line is skipped, but the file entry is still created
    expect(Object.keys(coverage["src/n.mts"]!.fnMap)).toHaveLength(0);
  });

  it("handles FNA: as an alias for FNDA:", () => {
    const lcov = buf(
      ["TN:", "SF:src/o.mts", "FN:5,aliasFunc", "FNA:3,aliasFunc", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(coverage["src/o.mts"]!.f["aliasFunc@5"]).toBe(3);
  });

  it("skips FNDA: line with no comma", () => {
    const lcov = buf(["TN:", "SF:src/p.mts", "FNDA:nocolon", "end_of_record"].join("\n"));
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(Object.keys(coverage["src/p.mts"]!.fnMap)).toHaveLength(0);
  });

  it("skips FNDA: line where hit count is not an integer", () => {
    const lcov = buf(
      ["TN:", "SF:src/q.mts", "FN:1,myFunc", "FNDA:notanumber,myFunc", "end_of_record"].join("\n"),
    );
    const coverage = lcovBufferToIstanbul(lcov, []);
    expect(Object.keys(coverage["src/q.mts"]!.fnMap)).toHaveLength(0);
  });
});

describe("CRLF line endings", () => {
  it("handles CRLF line endings correctly", () => {
    const lcov = buf("SF:foo.ts\r\nDA:1,1\r\nend_of_record\r\n");
    const cov = lcovBufferToIstanbul(lcov, []);
    expect(cov["foo.ts"]).toBeDefined();
    expect(cov["foo.ts"].s["1"]).toBe(1);
  });
});

describe("LCOV not ending in newline", () => {
  it("handles LCOV not ending in newline", () => {
    const lcov = buf("SF:foo.ts\nDA:1,1\nend_of_record");
    const cov = lcovBufferToIstanbul(lcov, []);
    expect(cov["foo.ts"]).toBeDefined();
    expect(cov["foo.ts"].s["1"]).toBe(1);
  });
});

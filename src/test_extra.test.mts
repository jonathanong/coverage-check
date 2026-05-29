import { describe, it, expect } from "vitest";
import { lcovBufferToIstanbul } from "./lcov-to-istanbul.mts";

describe("lcovBufferToIstanbul extra edge cases", () => {
  it("handles BRDA with missing fields", () => {
    const lcov = Buffer.from("TN:\nSF:file.ts\nBRDA:1\nBRDA:2,1\nBRDA:3,1,2\nend_of_record\n");
    const result = lcovBufferToIstanbul(lcov, []);
    expect(result).toEqual({
      "file.ts": expect.objectContaining({
        b: {},
        branchMap: {},
      }),
    });
  });

  it("handles invalid integers", () => {
    const lcov = Buffer.from("TN:\nSF:file.ts\nDA:a,b\nFNDA:a,b\nBRDA:a,b,c,d\nend_of_record\n");
    const result = lcovBufferToIstanbul(lcov, []);
    expect(result).toEqual({
      "file.ts": expect.objectContaining({
        statementMap: {},
        s: {},
        fnMap: {},
        f: {},
        branchMap: {},
        b: {},
      }),
    });
  });

  it("handles empty branch taken", () => {
    // This happens if takenStr === "-"
    const lcov = Buffer.from("TN:\nSF:file.ts\nBRDA:1,2,3,-\nend_of_record\n");
    const result = lcovBufferToIstanbul(lcov, []);
    expect(result).toEqual({
      "file.ts": expect.objectContaining({
        b: { "1-2": [0] },
      }),
    });
  });
});

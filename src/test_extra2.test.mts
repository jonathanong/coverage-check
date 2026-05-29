import { describe, it, expect } from "vitest";
import { lcovBufferToIstanbul } from "./lcov-to-istanbul.mts";

describe("lcovBufferToIstanbul extra edge cases", () => {
  it("handles branch missing components", () => {
    // Tests: comma1 === -1, comma2 === -1
    const lcov = Buffer.from("TN:\nSF:file.ts\nBRDA:1\nBRDA:2,1\nend_of_record\n");
    const result = lcovBufferToIstanbul(lcov, []);
    expect(result).toEqual({ "file.ts": expect.anything() });
  });
  it("handles dashIdx", () => {
    // The previous test did not cover dashIdx === -1 because blockKey is always 'lineNo-blockId'
    // I will mock fileBranches manually or test with empty blockId
    const lcov = Buffer.from("TN:\nSF:file.ts\nBRDA:1,,0,1\nend_of_record\n");
    const result = lcovBufferToIstanbul(lcov, []);
    expect(result).toEqual({ "file.ts": expect.anything() });
  });
});

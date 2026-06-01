import { describe, expect, it } from "vitest";
import { lcovBufferToIstanbul } from "./lcov-to-istanbul.mts";

function buf(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

describe("DA tests edge cases", () => {
  it("skips DA with negative index or parse errors in hit count", () => {
    const lcov = buf("TN:\nSF:src/da1.mts\nDA:5,a\nend_of_record\n");
    const cov = lcovBufferToIstanbul(lcov, []);
    expect(Object.keys(cov["src/da1.mts"]!.s)).toHaveLength(0);
  });
});

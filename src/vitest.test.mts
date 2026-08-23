import { describe, expect, it } from "vitest";
import { formatSupplementalLcov, isEmptyCoverageReport } from "./vitest.mts";

describe("Vitest provider helpers", () => {
  it("recognizes placeholder coverage", () => {
    expect(isEmptyCoverageReport({ fnMap: { 0: { name: "(empty-report)" } } })).toBe(true);
    expect(isEmptyCoverageReport({ fnMap: { 0: { name: "run" } } })).toBe(false);
  });

  it("formats stable supplemental LCOV", () => {
    expect(formatSupplementalLcov([{ path: "src/z.ts", hits: { "2": 0, "1": 2 } }])).toBe(
      "TN:\nSF:src/z.ts\nDA:1,2\nDA:2,0\nend_of_record\n",
    );
  });
});

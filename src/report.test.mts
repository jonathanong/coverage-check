import { describe, expect, it } from "vitest";
import { collapseRanges, renderFailureComment, COMMENT_MARKER } from "./report.mts";
import type { CoverageCheckResult, DropResult } from "./types.mts";

describe("collapseRanges", () => {
  it("returns empty string for empty input", () => {
    expect(collapseRanges([])).toBe("");
  });

  it("renders a single line", () => {
    expect(collapseRanges([5])).toBe("L5");
  });

  it("collapses consecutive lines into a range", () => {
    expect(collapseRanges([3, 4, 5])).toBe("L3-5");
  });

  it("separates non-consecutive lines with commas", () => {
    expect(collapseRanges([3, 4, 7, 9, 10])).toBe("L3-4, L7, L9-10");
  });

  it("handles unsorted input", () => {
    expect(collapseRanges([10, 1, 2])).toBe("L1-2, L10");
  });
});

describe("renderFailureComment", () => {
  const result: CoverageCheckResult = {
    passed: false,
    drops: [],
    buckets: [
      {
        rule: "backend/**",
        threshold: 90,
        coverable: 10,
        hit: 8,
        passed: false,
        files: [
          {
            file: "backend/services/foo.mts",
            coverable: 5,
            hit: 3,
            uncoveredLines: [11, 12],
            rule: "backend/**",
          },
        ],
      },
    ],
    informational: [],
  };

  it("includes the marker", () => {
    const comment = renderFailureComment(
      result,
      "https://example.com/run/1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(comment.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("includes failing bucket in the table", () => {
    const comment = renderFailureComment(
      result,
      "https://example.com/run/1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(comment).toContain("backend/**");
    expect(comment).toContain("90%");
  });

  it("includes uncovered lines", () => {
    const comment = renderFailureComment(
      result,
      "https://example.com/run/1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(comment).toContain("backend/services/foo.mts");
    expect(comment).toContain("L11-12");
  });

  it("renders informational section when unmatched files have uncovered lines", () => {
    const resultWithInfo: CoverageCheckResult = {
      ...result,
      informational: [
        { file: "scripts/misc.mts", coverable: 3, hit: 1, uncoveredLines: [4, 5], rule: null },
      ],
    };
    const comment = renderFailureComment(
      resultWithInfo,
      "https://example.com/run/1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(comment).toContain("Informational (no rule)");
    expect(comment).toContain("scripts/misc.mts");
    expect(comment).toContain("L4-5");
  });

  it("renders — when bucket has no coverable lines", () => {
    const resultNoCoverable: CoverageCheckResult = {
      passed: false,
      drops: [],
      buckets: [
        {
          rule: "backend/**",
          threshold: 90,
          coverable: 0,
          hit: 0,
          passed: false,
          files: [],
        },
      ],
      informational: [],
    };
    const comment = renderFailureComment(resultNoCoverable, "N/A", "2026-01-01T00:00:00.000Z");
    expect(comment).toContain("—");
  });

  it("renders _No line-level data available_ when bucket files have no uncovered lines", () => {
    const resultNoLines: CoverageCheckResult = {
      passed: false,
      drops: [],
      buckets: [
        {
          rule: "backend/**",
          threshold: 90,
          coverable: 5,
          hit: 4,
          passed: false,
          files: [
            {
              file: "backend/foo.mts",
              coverable: 5,
              hit: 4,
              uncoveredLines: [],
              rule: "backend/**",
            },
          ],
        },
      ],
      informational: [],
    };
    const comment = renderFailureComment(resultNoLines, "N/A", "2026-01-01T00:00:00.000Z");
    expect(comment).toContain("_No line-level data available_");
  });

  it("includes Coverage regression section and table when there are failing drops", () => {
    const failingDrop: DropResult = {
      rule: "backend/**",
      currentPct: 91.23,
      baselinePct: 95,
      drop: 3.77,
      maxDrop: 0,
      passed: false,
      skipped: false,
    };
    const resultWithDrop: CoverageCheckResult = {
      ...result,
      drops: [failingDrop],
    };
    const comment = renderFailureComment(
      resultWithDrop,
      "https://example.com/run/1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(comment).toContain("Coverage regression");
    expect(comment).toContain("backend/**");
    expect(comment).toContain("91.23%");
    expect(comment).toContain("95.00%");
    expect(comment).toContain("3.77pp");
    expect(comment).toContain("0pp");
  });

  it("does not include regression table when all drops are skipped", () => {
    const skippedDrop: DropResult = {
      rule: "backend/**",
      currentPct: null,
      baselinePct: null,
      drop: null,
      maxDrop: 0,
      passed: true,
      skipped: true,
    };
    const resultWithSkipped: CoverageCheckResult = {
      ...result,
      drops: [skippedDrop],
    };
    const comment = renderFailureComment(
      resultWithSkipped,
      "https://example.com/run/1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(comment).not.toContain("Coverage regression");
  });

  it("does not include regression table when drops array is empty", () => {
    const comment = renderFailureComment(
      result,
      "https://example.com/run/1",
      "2026-01-01T00:00:00.000Z",
    );
    expect(comment).not.toContain("Coverage regression");
  });
});

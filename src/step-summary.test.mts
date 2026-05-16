import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSummaryMarkdown, writeSummary } from "./step-summary.mts";
import type { SuiteSource } from "./step-summary.mts";
import type { CoverageCheckResult } from "./types.mts";

const passResult: CoverageCheckResult = {
  passed: true,
  buckets: [{ rule: "backend/**", threshold: 90, coverable: 10, hit: 10, passed: true, files: [] }],
  informational: [],
};

const failResult: CoverageCheckResult = {
  passed: false,
  buckets: [{ rule: "backend/**", threshold: 90, coverable: 10, hit: 8, passed: false, files: [] }],
  informational: [],
};

const freshSource: SuiteSource = {
  suite: "backend",
  source: "fresh",
  lcov: new Map([
    [
      "backend/foo.mts",
      new Map([
        [1, 1],
        [2, 0],
        [3, 1],
      ]),
    ],
  ]),
};

const storeSource: SuiteSource = {
  suite: "frontend",
  source: "store",
  lcov: new Map([
    [
      "web/app.tsx",
      new Map([
        [10, 1],
        [11, 1],
      ]),
    ],
  ]),
};

describe("buildSummaryMarkdown", () => {
  it("shows passed status in heading", () => {
    const md = buildSummaryMarkdown([freshSource], passResult, "https://example.com/run/1");
    expect(md).toContain("✅ passed");
  });

  it("shows failed status in heading", () => {
    const md = buildSummaryMarkdown([freshSource], failResult, "https://example.com/run/1");
    expect(md).toContain("❌ failed");
  });

  it("lists suite names with source labels", () => {
    const md = buildSummaryMarkdown(
      [freshSource, storeSource],
      passResult,
      "https://example.com/run/1",
    );
    expect(md).toContain("`backend`");
    expect(md).toContain("fresh");
    expect(md).toContain("`frontend`");
    expect(md).toContain("store (main)");
  });

  it("uses the provided branch name in store source label", () => {
    const md = buildSummaryMarkdown(
      [storeSource],
      passResult,
      "https://example.com/run/1",
      "feature/my-branch",
    );
    expect(md).toContain("store (feature/my-branch)");
  });

  it("shows line coverage percentage for suite", () => {
    const md = buildSummaryMarkdown([freshSource], passResult, "https://example.com/run/1");
    // 2/3 lines covered = 66.7%
    expect(md).toContain("66.7%");
  });

  it("shows — for empty lcov data", () => {
    const emptySource: SuiteSource = { suite: "empty", source: "fresh", lcov: new Map() };
    const md = buildSummaryMarkdown([emptySource], passResult, "https://example.com/run/1");
    expect(md).toContain("—");
  });

  it("shows rule thresholds and pass/fail status", () => {
    const md = buildSummaryMarkdown([freshSource], passResult, "https://example.com/run/1");
    expect(md).toContain("backend/**");
    expect(md).toContain("90%");
    expect(md).toContain("✅");
  });

  it("shows ❌ for failing rule", () => {
    const md = buildSummaryMarkdown([freshSource], failResult, "https://example.com/run/1");
    expect(md).toContain("❌");
  });

  it("shows — in rule table when bucket has no coverable lines", () => {
    const noCoverableResult: CoverageCheckResult = {
      passed: false,
      buckets: [
        { rule: "backend/**", threshold: 90, coverable: 0, hit: 0, passed: false, files: [] },
      ],
      informational: [],
    };
    const md = buildSummaryMarkdown([], noCoverableResult, "N/A");
    expect(md).toContain("—");
  });

  it("renders empty-suite placeholder row when no sources provided", () => {
    const md = buildSummaryMarkdown([], passResult, "N/A");
    expect(md).toContain("| — | — | — |");
  });

  it("renders empty-rule placeholder row when no buckets provided", () => {
    const emptyResult: CoverageCheckResult = { passed: true, buckets: [], informational: [] };
    const md = buildSummaryMarkdown([], emptyResult, "N/A");
    expect(md).toContain("| — | — | — | — |");
  });

  it("includes run link when runUrl is a valid URL", () => {
    const md = buildSummaryMarkdown([], passResult, "https://example.com/run/42");
    expect(md).toContain("https://example.com/run/42");
    expect(md).toContain("[View run]");
  });

  it("omits run link when runUrl is N/A", () => {
    const md = buildSummaryMarkdown([], passResult, "N/A");
    expect(md).not.toContain("[View run]");
    expect(md).not.toContain("N/A");
  });
});

describe("writeSummary", () => {
  let tmpDir: string;
  let summaryFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "step-summary-"));
    summaryFile = join(tmpDir, "summary.md");
    writeFileSync(summaryFile, "");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends summary markdown to the summary file", () => {
    writeSummary(summaryFile, [freshSource], passResult, "https://example.com");
    const content = readFileSync(summaryFile, "utf8");
    expect(content).toContain("Coverage summary");
    expect(content).toContain("backend");
  });

  it("appends to existing content", () => {
    writeFileSync(summaryFile, "# Prior content\n");
    writeSummary(summaryFile, [], passResult, "N/A");
    const content = readFileSync(summaryFile, "utf8");
    expect(content).toContain("# Prior content");
    expect(content).toContain("Coverage summary");
  });
});

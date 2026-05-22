import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCoverageSummary, parseCoverageSummaryArgs } from "./summary.mts";
import { groupSuitesBySourceFolder } from "./summary/groups.mts";
import { renderCoverageSummaryMarkdown } from "./summary/markdown.mts";
import { parseLcov } from "../lcov-parser.mts";
import { buildStripPrefixes } from "../load-artifacts.mts";
import type { CoverageSummary } from "./summary.mts";

function tmpRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "coverage-summary-"));
}

function writeLcov(file: string, sourceFile: string, lines: Array<[number, number]>): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      "TN:",
      `SF:${sourceFile}`,
      ...lines.map(([line, hits]) => `DA:${line},${hits}`),
      "end_of_record",
    ].join("\n"),
  );
}

function writeArtifact(
  root: string,
  suite: string,
  sourceFile: string,
  lines: Array<[number, number]>,
): void {
  writeLcov(
    path.join(root, "coverage-artifacts", `coverage-${suite}`, "lcov.info"),
    sourceFile,
    lines,
  );
}

function writeLegacyStore(
  root: string,
  suite: string,
  sourceFile: string,
  lines: Array<[number, number]>,
): void {
  writeLcov(path.join(root, "coverage-store", suite, "lcov.info"), sourceFile, lines);
}

function writeCoverageRules(root: string, patterns: string[]): string {
  const rulesFile = path.join(root, ".coverage-rules.yml");
  writeFileSync(
    rulesFile,
    [
      "rules:",
      ...patterns.flatMap((pattern) => [`  - paths: '${pattern}'`, "    patch_coverage_min: 0"]),
    ].join("\n"),
  );
  return rulesFile;
}

function makeLcov(
  files: Record<string, Array<[number, number]>>,
): Map<string, Map<number, number>> {
  return new Map(Object.entries(files).map(([file, lines]) => [file, new Map(lines)] as const));
}

describe("coverage summary", () => {
  it("summarizes current-run coverage without a historical store", async () => {
    const root = tmpRoot();
    const rulesFile = writeCoverageRules(root, ["backend/**"]);
    writeArtifact(root, "backend", "backend/a.mts", [
      [1, 1],
      [2, 0],
    ]);

    const summary = await buildCoverageSummary({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      rulesFile,
      storeFs: null,
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(summary.currentTotals).toEqual({ hit: 1, total: 2 });
    expect(summary.totals).toEqual({ hit: 1, total: 2 });
    expect(summary.groups.map((group) => [group.folder, group.source])).toEqual([
      ["backend", "current"],
    ]);
    expect(summary.warnings).toEqual([
      "Historical main coverage store was not configured; showing current-run coverage only.",
    ]);
  });

  it("uses historical main coverage for suites missing from the current run", async () => {
    const root = tmpRoot();
    const rulesFile = writeCoverageRules(root, ["backend/**", "web/**"]);
    writeArtifact(root, "backend", "backend/a.mts", [
      [1, 1],
      [2, 0],
    ]);
    writeLegacyStore(root, "backend", "backend/a.mts", [
      [1, 1],
      [2, 1],
    ]);
    writeLegacyStore(root, "web", "web/a.tsx", [[1, 1]]);
    writeLegacyStore(root, "deleted-suite", "deleted/a.ts", [[1, 1]]);

    const summary = await buildCoverageSummary({
      activeSuites: ["web"],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      rulesFile,
      storeFs: path.join(root, "coverage-store"),
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(summary.currentTotals).toEqual({ hit: 1, total: 2 });
    expect(summary.totals).toEqual({ hit: 2, total: 3 });
    expect(summary.groups.map((group) => [group.folder, group.source])).toEqual([
      ["backend", "current"],
      ["web", "history"],
    ]);
    expect(summary.warnings).toEqual([]);
  });

  it("groups coverage from multiple suites by source folder", async () => {
    const root = tmpRoot();
    const rulesFile = writeCoverageRules(root, ["backend/**", "web/**"]);
    writeArtifact(root, "backend-one", "backend/a.mts", [[1, 1]]);
    writeArtifact(root, "backend-two", "backend/b.mts", [[1, 0]]);
    writeLegacyStore(root, "web", "web/a.tsx", [[1, 1]]);

    const summary = await buildCoverageSummary({
      activeSuites: ["web"],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      rulesFile,
      storeFs: path.join(root, "coverage-store"),
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(summary.groups.map((group) => [group.folder, group.source])).toEqual([
      ["backend", "current"],
      ["web", "history"],
    ]);
    expect(summary.groups.find((group) => group.folder === "backend")).toMatchObject({
      lcov: new Map([
        ["backend/a.mts", new Map([[1, 1]])],
        ["backend/b.mts", new Map([[1, 0]])],
      ]),
    });
  });

  it("renders total and per-folder coverage for the step summary", async () => {
    const root = tmpRoot();
    writeArtifact(root, "weird-suite", "other|folder`name/a.mts", [
      [1, 1],
      [2, 1],
    ]);
    const summary = await buildCoverageSummary({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      rulesFile: path.join(root, ".coverage-rules.yml"),
      storeFs: null,
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(renderCoverageSummaryMarkdown(summary, "main")).toContain(
      "Current run line coverage: **100.0% (2/2)**",
    );
    expect(renderCoverageSummaryMarkdown(summary, "main")).toContain(
      "Total project line coverage: **100.0% (2/2)**",
    );
    expect(renderCoverageSummaryMarkdown(summary, "main")).toContain(
      "| `other` | current run | 100.0% (2/2) |",
    );
    expect(renderCoverageSummaryMarkdown(summary, "main")).toContain(
      "| Source folder | Source | Line coverage |",
    );
  });

  it("falls back to the other coverage group when rules are missing", () => {
    const root = tmpRoot();

    const groups = groupSuitesBySourceFolder(
      [
        {
          suite: "generated",
          source: "current",
          lcov: makeLcov({ "generated/a.mts": [[1, 1]] }),
        },
      ],
      "main",
      path.join(root, ".coverage-rules.yml"),
    );

    expect(groups.map((group) => [group.folder, group.source])).toEqual([["other", "current"]]);
  });

  it("uses coverage rule order and falls through unmatched files to other", () => {
    const root = tmpRoot();
    writeFileSync(
      path.join(root, ".coverage-rules.yml"),
      [
        "rules:",
        "  - paths: 'web/lib/api/**'",
        "    patch_coverage_min: 100",
        "  - paths: 'web/**'",
        "    patch_coverage_min: 5",
      ].join("\n"),
    );

    const groups = groupSuitesBySourceFolder(
      [
        {
          suite: "web",
          source: "current",
          lcov: makeLcov({
            "web/lib/api/route.mts": [[1, 1]],
            "web/page.tsx": [[1, 1]],
            "scripts/tool.mts": [[1, 0]],
          }),
        },
      ],
      "main",
      path.join(root, ".coverage-rules.yml"),
    );

    expect(groups.map((group) => group.folder)).toEqual(["web/lib/api", "web", "other"]);
  });

  it("extracts source folders from non-directory-only glob rules", () => {
    const root = tmpRoot();
    writeFileSync(
      path.join(root, ".coverage-rules.yml"),
      ["rules:", "  - paths: 'web/lib/**/*.ts'"].join("\n"),
    );

    const groups = groupSuitesBySourceFolder(
      [{ suite: "web", source: "current", lcov: makeLcov({ "web/lib/a.ts": [[1, 1]] }) }],
      "main",
      path.join(root, ".coverage-rules.yml"),
    );

    expect(groups.map((group) => group.folder)).toEqual(["web/lib"]);
  });

  it("renders mixed current and historical coverage with the history branch label", () => {
    const root = tmpRoot();
    writeFileSync(
      path.join(root, ".coverage-rules.yml"),
      ["rules:", "  - paths: 'backend/**'"].join("\n"),
    );

    const groups = groupSuitesBySourceFolder(
      [
        {
          suite: "backend-current",
          source: "current",
          branch: "feature-branch",
          lcov: makeLcov({ "backend/a.mts": [[1, 1]] }),
        },
        {
          suite: "backend-history",
          source: "history",
          branch: "main",
          lcov: makeLcov({ "backend/b.mts": [[1, 0]] }),
        },
        {
          suite: "backend-history-release",
          source: "history",
          branch: "release",
          lcov: makeLcov({ "backend/c.mts": [[1, 1]] }),
        },
      ],
      "fallback-branch",
      path.join(root, ".coverage-rules.yml"),
    );

    expect(groups[0]).toMatchObject({
      folder: "backend",
      source: "mixed",
      branchesLabel: "main, release",
    });
    expect(
      renderCoverageSummaryMarkdown(
        {
          currentTotals: { hit: 1, total: 1 },
          groups,
          suites: [],
          totals: { hit: 2, total: 3 },
          warnings: [],
        },
        "fallback-branch",
      ),
    ).toContain("| `backend` | current run + history (main, release) | 66.7% (2/3) |");
  });

  it("matches exact file and directory coverage rules", () => {
    const root = tmpRoot();
    const rulesFile = path.join(root, ".coverage-rules.yml");
    writeFileSync(rulesFile, ["rules:", "  - paths: 'README.md'", "  - paths: 'web'"].join("\n"));
    const groups = groupSuitesBySourceFolder(
      [
        {
          suite: "docs-and-web",
          source: "current",
          lcov: makeLcov({ "README.md": [[1, 1]], web: [[1, 1]] }),
        },
      ],
      "main",
      rulesFile,
    );
    expect(groups.map((group) => group.folder)).toEqual(["README.md", "web"]);
  });

  it("validates mutually exclusive store options", () => {
    expect(() =>
      parseCoverageSummaryArgs(["--store-fs", "./coverage-store", "--store-s3", "bucket/prefix"]),
    ).toThrow("--store-fs and --store-s3 are mutually exclusive");
  });

  it("accumulates duplicate DA records for the same file and line", () => {
    const lcov = parseLcov(
      ["TN:", "SF:ci/a.mts", "DA:1,1", "end_of_record", "TN:", "SF:ci/a.mts", "DA:1,0"].join("\n"),
    );

    expect(lcov.get("ci/a.mts")?.get(1)).toBe(1);
  });

  it("prefers more specific strip prefixes when normalizing source files", () => {
    const root = tmpRoot();
    const nested = path.join(root, "nested");
    const prefixes = buildStripPrefixes([nested]);
    const lcov = parseLcov(`TN:\nSF:${path.join(nested, "ci/a.mts")}\nDA:1,1`, prefixes);

    expect([...lcov.keys()]).toEqual(["ci/a.mts"]);
  });
});

describe("renderCoverageSummaryMarkdown", () => {
  function emptySummary(): CoverageSummary {
    return {
      currentTotals: { hit: 1, total: 1 },
      groups: [],
      suites: [],
      totals: { hit: 1, total: 1 },
      warnings: [],
    };
  }

  it("includes an S3 console link when storeS3 is set", () => {
    const md = renderCoverageSummaryMarkdown(emptySummary(), "main", "my-bucket/my-prefix");
    expect(md).toContain(
      "[`s3://my-bucket/my-prefix`](https://s3.console.aws.amazon.com/s3/buckets/my-bucket?prefix=my-prefix/)",
    );
  });

  it("URL-encodes special characters in the prefix", () => {
    const md = renderCoverageSummaryMarkdown(emptySummary(), "main", "my-bucket/path with spaces");
    expect(md).toContain("?prefix=path%20with%20spaces/");
  });

  it("includes a bucket-only S3 console link when there is no prefix", () => {
    const md = renderCoverageSummaryMarkdown(emptySummary(), "main", "my-bucket");
    expect(md).toContain(
      "[`s3://my-bucket`](https://s3.console.aws.amazon.com/s3/buckets/my-bucket)",
    );
    expect(md).not.toContain("prefix=");
  });

  it("omits the S3 link when storeS3 is null", () => {
    expect(renderCoverageSummaryMarkdown(emptySummary(), "main", null)).not.toContain("s3://");
  });

  it("omits the S3 link when storeS3 is omitted", () => {
    expect(renderCoverageSummaryMarkdown(emptySummary(), "main")).not.toContain("s3://");
  });
});

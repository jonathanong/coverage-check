import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoverageSummary, main, parseCoverageSummaryArgs } from "./summary.mts";
import { groupSuitesBySourceFolder } from "./summary/groups.mts";
import { renderCoverageSummaryMarkdown } from "./summary/markdown.mts";
import { parseCoverageSummaryArgs as parseSummaryArgsDirectly } from "./summary/args.mts";
import { parseLcov } from "../lcov-parser.mts";
import { buildStripPrefixes } from "../load-artifacts.mts";
import type { CoverageSummary } from "./summary.mts";
import { FileSystemSuiteStore } from "../suite-store.mts";

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

  it("drops rules whose glob starts at position 0 (no static prefix)", () => {
    const root = tmpRoot();
    const rulesFile = path.join(root, ".coverage-rules.yml");
    // '**' has a glob at index 0 → staticPrefix="" → folder="" → null → skipped
    writeFileSync(rulesFile, ["rules:", "  - paths: '**'", "  - paths: 'backend/**'"].join("\n"));
    const groups = groupSuitesBySourceFolder(
      [{ suite: "s", source: "current", lcov: makeLcov({ "backend/a.mts": [[1, 1]] }) }],
      "main",
      rulesFile,
    );
    // '**' rule produces no folder, so only 'backend' group appears
    expect(groups.map((g) => g.folder)).toEqual(["backend"]);
  });

  it("handles array paths in a coverage rule", () => {
    const root = tmpRoot();
    const rulesFile = path.join(root, ".coverage-rules.yml");
    writeFileSync(
      rulesFile,
      [
        "rules:",
        "  - paths:",
        "      - 'backend/**'",
        "      - 'web/**'",
        "    patch_coverage_min: 0",
      ].join("\n"),
    );
    const groups = groupSuitesBySourceFolder(
      [
        {
          suite: "all",
          source: "current",
          lcov: makeLcov({ "backend/a.mts": [[1, 1]], "web/a.tsx": [[1, 1]] }),
        },
      ],
      "main",
      rulesFile,
    );
    expect(groups.map((g) => g.folder)).toContain("backend");
    expect(groups.map((g) => g.folder)).toContain("web");
  });

  it("handles rules with no paths field (undefined paths)", () => {
    const root = tmpRoot();
    const rulesFile = path.join(root, ".coverage-rules.yml");
    // A rule with no 'paths' key — paths is undefined → treated as empty → no group
    writeFileSync(
      rulesFile,
      ["rules:", "  - patch_coverage_min: 90", "  - paths: 'backend/**'"].join("\n"),
    );
    const groups = groupSuitesBySourceFolder(
      [{ suite: "s", source: "current", lcov: makeLcov({ "backend/a.mts": [[1, 1]] }) }],
      "main",
      rulesFile,
    );
    expect(groups.map((g) => g.folder)).toEqual(["backend"]);
  });

  it("treats a non-array rules field in the YAML as empty rules", () => {
    const root = tmpRoot();
    const rulesFile = path.join(root, ".coverage-rules.yml");
    // rules is a string, not an array → falls through to [] → everything becomes "other"
    writeFileSync(rulesFile, "rules: not-an-array\n");
    const groups = groupSuitesBySourceFolder(
      [{ suite: "s", source: "current", lcov: makeLcov({ "backend/a.mts": [[1, 1]] }) }],
      "main",
      rulesFile,
    );
    expect(groups.map((g) => g.folder)).toEqual(["other"]);
  });

  it("uses fallback branch when history suite has no branch property", () => {
    const root = tmpRoot();
    const rulesFile = writeCoverageRules(root, ["backend/**"]);
    const groups = groupSuitesBySourceFolder(
      [
        {
          suite: "backend-history",
          source: "history",
          // branch is intentionally undefined → falls back to the 'branch' arg
          lcov: makeLcov({ "backend/a.mts": [[1, 1]] }),
        },
      ],
      "fallback-main",
      rulesFile,
    );
    expect(groups[0]?.branchesLabel).toBe("fallback-main");
  });

  it("warns when store is configured but active suites list is empty", async () => {
    const root = tmpRoot();
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);
    const storeDir = path.join(root, "coverage-store");
    mkdirSync(storeDir, { recursive: true });

    const summary = await buildCoverageSummary({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      storeFs: storeDir,
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(summary.warnings).toEqual([
      "Historical main coverage store was configured without an active suite manifest; showing current-run coverage only.",
    ]);
  });

  it("returns empty summary when artifacts dir does not exist", async () => {
    const root = tmpRoot();

    const summary = await buildCoverageSummary({
      activeSuites: [],
      artifacts: path.join(root, "nonexistent-artifacts"),
      branch: "main",
      storeFs: null,
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(summary.suites).toEqual([]);
    expect(summary.currentTotals).toEqual({ hit: 0, total: 0 });
  });

  it("skips artifact dirs that don't start with 'coverage-' prefix", async () => {
    const root = tmpRoot();
    const rulesFile = writeCoverageRules(root, ["backend/**"]);
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);
    // Create a dir without the coverage- prefix — should be ignored
    const ignoredDir = path.join(root, "coverage-artifacts", "unrelated-dir");
    mkdirSync(ignoredDir, { recursive: true });
    writeFileSync(path.join(ignoredDir, "lcov.info"), "TN:\nSF:other/a.mts\nDA:1,1\nend_of_record");

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

    // "unrelated-dir" is ignored, only "backend" suite is used
    expect(summary.groups.map((g) => g.folder)).toEqual(["backend"]);
  });

  it("skips artifact dirs that contain no lcov files (summary variant)", async () => {
    const root = tmpRoot();
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);
    mkdirSync(path.join(root, "coverage-artifacts", "coverage-empty"), { recursive: true });

    const summary = await buildCoverageSummary({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      storeFs: null,
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(summary.suites.map((s) => s.suite)).not.toContain("empty");
    expect(summary.suites.map((s) => s.suite)).toContain("backend");
  });

  it("skips artifact dirs named exactly 'coverage-' (empty suite name)", async () => {
    const root = tmpRoot();
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);
    mkdirSync(path.join(root, "coverage-artifacts", "coverage-"), { recursive: true });
    writeFileSync(
      path.join(root, "coverage-artifacts", "coverage-", "lcov.info"),
      "TN:\nSF:other/a.mts\nDA:1,1\nend_of_record\n",
    );

    const summary = await buildCoverageSummary({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      storeFs: null,
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(summary.suites.map((s) => s.suite)).not.toContain("");
    expect(summary.suites.map((s) => s.suite)).toContain("backend");
  });

  it("warns when active suites are missing from the historical store (sorts alphabetically)", async () => {
    const root = tmpRoot();
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);
    const storeDir = path.join(root, "coverage-store");
    mkdirSync(storeDir, { recursive: true });

    const summary = await buildCoverageSummary({
      activeSuites: ["backend", "zoo-suite", "alpha-suite"],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      storeFs: storeDir,
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    // Two missing suites trigger the sort comparator and the warning message
    expect(summary.warnings).toEqual([
      "Historical main coverage missing for active suites: alpha-suite, zoo-suite.",
    ]);
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

  it("shows '--' for pct when total is zero", () => {
    const summary: CoverageSummary = {
      currentTotals: { hit: 0, total: 0 },
      groups: [],
      suites: [],
      totals: { hit: 0, total: 0 },
      warnings: [],
    };
    const md = renderCoverageSummaryMarkdown(summary, "main");
    expect(md).toContain("Current run line coverage: **--**");
    expect(md).toContain("Total project line coverage: **--**");
  });

  it("renders a history-source group row with branch label", () => {
    const summary: CoverageSummary = {
      currentTotals: { hit: 0, total: 0 },
      groups: [
        {
          folder: "backend",
          source: "history",
          branchesLabel: "main",
          lcov: new Map([["backend/a.mts", new Map([[1, 1]])]]),
        },
      ],
      suites: [],
      totals: { hit: 1, total: 1 },
      warnings: [],
    };
    const md = renderCoverageSummaryMarkdown(summary, "main");
    expect(md).toContain("| `backend` | history (main) | 100.0% (1/1) |");
  });

  it("uses fallback branch label when branchesLabel is undefined for history source", () => {
    const summary: CoverageSummary = {
      currentTotals: { hit: 0, total: 0 },
      groups: [
        {
          folder: "web",
          source: "history",
          // branchesLabel omitted — should fall back to the branch arg
          lcov: new Map([["web/a.tsx", new Map([[1, 1]])]]),
        },
      ],
      suites: [],
      totals: { hit: 1, total: 1 },
      warnings: [],
    };
    const md = renderCoverageSummaryMarkdown(summary, "my-branch");
    expect(md).toContain("| `web` | history (my-branch) | 100.0% (1/1) |");
  });

  it("uses fallback branch label when branchesLabel is undefined for mixed source", () => {
    const summary: CoverageSummary = {
      currentTotals: { hit: 0, total: 0 },
      groups: [
        {
          folder: "api",
          source: "mixed",
          // branchesLabel omitted — should fall back to the branch arg
          lcov: new Map([["api/a.mts", new Map([[1, 1]])]]),
        },
      ],
      suites: [],
      totals: { hit: 1, total: 1 },
      warnings: [],
    };
    const md = renderCoverageSummaryMarkdown(summary, "feature-x");
    expect(md).toContain("| `api` | current run + history (feature-x) | 100.0% (1/1) |");
  });

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

  it("uses backtick fencing when folder name contains a backtick", () => {
    const summary: CoverageSummary = {
      currentTotals: { hit: 1, total: 1 },
      groups: [
        {
          folder: "some`folder",
          source: "current",
          lcov: new Map([["some`folder/a.mts", new Map([[1, 1]])]]),
        },
      ],
      suites: [],
      totals: { hit: 1, total: 1 },
      warnings: [],
    };
    const md = renderCoverageSummaryMarkdown(summary, "main");
    // codeSpan escapes backticks by using longer fencing (`` `` some`folder `` ``)
    expect(md).toContain("`` some`folder ``");
  });
});

describe("parseCoverageSummaryArgs", () => {
  it("sets --active-suite", () => {
    const args = parseSummaryArgsDirectly(["--active-suite", "backend"]);
    expect(args.activeSuites).toEqual(["backend"]);
  });

  it("sets --artifacts", () => {
    const args = parseSummaryArgsDirectly(["--artifacts", "./my-artifacts"]);
    expect(args.artifacts).toBe("./my-artifacts");
  });

  it("sets --branch", () => {
    const args = parseSummaryArgsDirectly(["--branch", "feature-xyz"]);
    expect(args.branch).toBe("feature-xyz");
  });

  it("sets --rules", () => {
    const args = parseSummaryArgsDirectly(["--rules", "./.coverage-rules.yml"]);
    expect(args.rulesFile).toBe("./.coverage-rules.yml");
  });

  it("sets --strip-prefix", () => {
    const args = parseSummaryArgsDirectly(["--strip-prefix", "/workspace"]);
    expect(args.stripPrefixes).toEqual(["/workspace"]);
  });

  it("sets --store-fs", () => {
    const args = parseSummaryArgsDirectly(["--store-fs", "./coverage-store"]);
    expect(args.storeFs).toBe("./coverage-store");
  });

  it("sets --store-s3", () => {
    const args = parseSummaryArgsDirectly(["--store-s3", "my-bucket/prefix"]);
    expect(args.storeS3).toBe("my-bucket/prefix");
  });

  it("--store-fs and --store-s3 are mutually exclusive", () => {
    expect(() =>
      parseSummaryArgsDirectly(["--store-fs", "./store", "--store-s3", "bucket/prefix"]),
    ).toThrow("--store-fs and --store-s3 are mutually exclusive");
  });

  it("--branch empty string throws", () => {
    expect(() => parseSummaryArgsDirectly(["--branch", ""])).toThrow("--branch must not be empty");
  });

  it("unknown flag throws", () => {
    expect(() => parseSummaryArgsDirectly(["--unknown-flag"])).toThrow(
      "unknown flag: --unknown-flag",
    );
  });

  it("flag missing value throws", () => {
    expect(() => parseSummaryArgsDirectly(["--artifacts"])).toThrow("--artifacts requires a value");
  });

  it("--no-summary-file sets summaryFile to null", () => {
    const args = parseSummaryArgsDirectly(["--no-summary-file"]);
    expect(args.summaryFile).toBeNull();
  });

  it("--summary-file <path> sets summaryFile to the given path", () => {
    const args = parseSummaryArgsDirectly(["--summary-file", "./step-summary.md"]);
    expect(args.summaryFile).toBe("./step-summary.md");
  });

  it("default summaryFile is process.env.GITHUB_STEP_SUMMARY ?? null", () => {
    const original = process.env["GITHUB_STEP_SUMMARY"];
    delete process.env["GITHUB_STEP_SUMMARY"];
    try {
      const argsWithoutEnv = parseSummaryArgsDirectly([]);
      expect(argsWithoutEnv.summaryFile).toBeNull();
    } finally {
      if (original !== undefined) process.env["GITHUB_STEP_SUMMARY"] = original;
    }
  });

  it("default summaryFile picks up GITHUB_STEP_SUMMARY env var", () => {
    const original = process.env["GITHUB_STEP_SUMMARY"];
    process.env["GITHUB_STEP_SUMMARY"] = "/github/file_commands/summary.md";
    try {
      const argsWithEnv = parseSummaryArgsDirectly([]);
      expect(argsWithEnv.summaryFile).toBe("/github/file_commands/summary.md");
    } finally {
      if (original !== undefined) process.env["GITHUB_STEP_SUMMARY"] = original;
      else delete process.env["GITHUB_STEP_SUMMARY"];
    }
  });
});

describe("summary main()", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "coverage-summary-main-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 2 and writes to stderr on invalid flag", async () => {
    const stderrChunks: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
      stderrChunks.push(String(c));
      return true;
    });
    try {
      const code = await main(["--invalid-flag", "value"]);
      expect(code).toBe(2);
      expect(stderrChunks.join("")).toContain("unknown flag: --invalid-flag");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("writes markdown to stdout when --no-summary-file is given", async () => {
    const artifactsDir = path.join(tmpDir, "coverage-artifacts");
    mkdirSync(path.join(artifactsDir, "coverage-backend"), { recursive: true });
    writeFileSync(
      path.join(artifactsDir, "coverage-backend", "lcov.info"),
      "TN:\nSF:backend/a.mts\nDA:1,1\nend_of_record\n",
    );

    const code = await main(["--artifacts", artifactsDir, "--branch", "main", "--no-summary-file"]);
    expect(code).toBe(0);
  });

  it("appends markdown to summary file when --summary-file is given", async () => {
    const artifactsDir = path.join(tmpDir, "coverage-artifacts");
    mkdirSync(path.join(artifactsDir, "coverage-backend"), { recursive: true });
    writeFileSync(
      path.join(artifactsDir, "coverage-backend", "lcov.info"),
      "TN:\nSF:backend/a.mts\nDA:1,1\nend_of_record\n",
    );
    const summaryFile = path.join(tmpDir, "step-summary.md");
    writeFileSync(summaryFile, "");

    const code = await main([
      "--artifacts",
      artifactsDir,
      "--branch",
      "main",
      "--summary-file",
      summaryFile,
    ]);
    expect(code).toBe(0);
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(summaryFile, "utf8");
    expect(content).toContain("## Project coverage summary");
  });

  it("writes markdown to process.stdout when --no-summary-file is set", async () => {
    const artifactsDir = path.join(tmpDir, "coverage-artifacts");
    mkdirSync(path.join(artifactsDir, "coverage-backend"), { recursive: true });
    writeFileSync(
      path.join(artifactsDir, "coverage-backend", "lcov.info"),
      "TN:\nSF:backend/a.mts\nDA:1,1\nend_of_record\n",
    );

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      stdoutChunks.push(String(c));
      return true;
    });
    try {
      const code = await main([
        "--artifacts",
        artifactsDir,
        "--branch",
        "main",
        "--no-summary-file",
      ]);
      expect(code).toBe(0);
      expect(stdoutChunks.join("")).toContain("## Project coverage summary");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("buildCoverageSummary historical store error", () => {
  it("returns a warning with error message when store.get throws", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "coverage-summary-err-"));
    const artifactsDir = path.join(root, "coverage-artifacts");
    mkdirSync(path.join(artifactsDir, "coverage-web"), { recursive: true });
    writeFileSync(
      path.join(artifactsDir, "coverage-web", "lcov.info"),
      "TN:\nSF:web/a.tsx\nDA:1,1\nend_of_record\n",
    );
    const storeDir = path.join(root, "coverage-store");
    mkdirSync(storeDir);

    // Use an active suite name with "/" which causes assertSafePathComponent to
    // throw inside store.get(), which is caught by the try/catch in loadHistoricalSuites.
    const summary = await buildCoverageSummary({
      activeSuites: ["web", "invalid/suite/name"],
      artifacts: artifactsDir,
      branch: "main",
      storeFs: storeDir,
      storeS3: null,
      summaryFile: null,
      stripPrefixes: [],
    });

    expect(summary.warnings.some((w) => w.includes("could not be read"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("uses String(error) when a non-Error is thrown by the store", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "coverage-summary-str-err-"));
    const artifactsDir = path.join(root, "coverage-artifacts");
    mkdirSync(path.join(artifactsDir, "coverage-web"), { recursive: true });
    writeFileSync(
      path.join(artifactsDir, "coverage-web", "lcov.info"),
      "TN:\nSF:web/a.tsx\nDA:1,1\nend_of_record\n",
    );
    const storeDir = path.join(root, "coverage-store");
    mkdirSync(storeDir);

    vi.spyOn(FileSystemSuiteStore.prototype, "get").mockRejectedValueOnce("plain string error");
    try {
      const summary = await buildCoverageSummary({
        activeSuites: ["web", "backend"],
        artifacts: artifactsDir,
        branch: "main",
        storeFs: storeDir,
        storeS3: null,
        summaryFile: null,
        stripPrefixes: [],
      });
      expect(summary.warnings.some((w) => w.includes("plain string error"))).toBe(true);
    } finally {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCoverageHtml, parseCoverageHtmlArgs } from "./html.mts";

function tmpRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "coverage-html-"));
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

describe("coverage html", () => {
  it("generates index.html from two current-run suites with no store", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    writeArtifact(root, "backend", "backend/a.mts", [
      [1, 1],
      [2, 0],
    ]);
    writeArtifact(root, "web", "web/a.tsx", [[1, 1]]);

    const { warnings } = await buildCoverageHtml({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: null,
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(warnings).toEqual([
      "Historical main coverage store was not configured; showing current-run coverage only.",
    ]);
  });

  it("merges one current-run suite and one historical suite from a filesystem store", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);
    writeLegacyStore(root, "web", "web/a.tsx", [[1, 1]]);

    const { warnings } = await buildCoverageHtml({
      activeSuites: ["backend", "web"],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: path.join(root, "coverage-store"),
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("warns when no store is configured and an active-suite is missing from current run", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);

    const { warnings } = await buildCoverageHtml({
      activeSuites: ["backend", "web"],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: null,
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(warnings).toEqual([
      "Historical main coverage store was not configured; showing current-run coverage only.",
    ]);
  });

  it("warns when store.get returns null for a missing historical suite", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);

    const { warnings } = await buildCoverageHtml({
      activeSuites: ["backend", "missing-suite"],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: path.join(root, "coverage-store"),
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(warnings).toEqual([
      "Historical main coverage missing for active suites: missing-suite.",
    ]);
  });

  it("sorts multiple missing historical suites alphabetically in the warning", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);

    const { warnings } = await buildCoverageHtml({
      activeSuites: ["backend", "web", "lambdas"],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: path.join(root, "coverage-store"),
      storeS3: null,
      stripPrefixes: [],
    });

    expect(warnings).toEqual(["Historical main coverage missing for active suites: lambdas, web."]);
  });

  it("skips report generation when no suites are found", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");

    const { warnings } = await buildCoverageHtml({
      activeSuites: [],
      artifacts: path.join(root, "nonexistent-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: null,
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(false);
    expect(warnings).toEqual([
      "Historical main coverage store was not configured; showing current-run coverage only.",
    ]);
  });

  it("validates mutually exclusive store options", () => {
    expect(() =>
      parseCoverageHtmlArgs(["--store-fs", "./coverage-store", "--store-s3", "bucket/prefix"]),
    ).toThrow("--store-fs and --store-s3 are mutually exclusive");
  });

  it("rejects unknown flags", () => {
    expect(() => parseCoverageHtmlArgs(["--unknown-flag", "value"])).toThrow(
      "unknown flag: --unknown-flag",
    );
  });

  it("rejects a flag missing its value", () => {
    expect(() => parseCoverageHtmlArgs(["--artifacts"])).toThrow("--artifacts requires a value");
  });

  it("rejects empty --branch value", () => {
    expect(() => parseCoverageHtmlArgs(["--branch", ""])).toThrow("--branch must not be empty");
  });

  it("applies default args when no argv is given", () => {
    const args = parseCoverageHtmlArgs([]);
    expect(args.artifacts).toBe("./coverage-artifacts");
    expect(args.branch).toBe("main");
    expect(args.output).toBe("./coverage-html");
    expect(args.activeSuites).toEqual([]);
    expect(args.storeFs).toBeNull();
    expect(args.storeS3).toBeNull();
  });

  it("store configured but no active suites gives a warning", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);

    const { warnings } = await buildCoverageHtml({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: path.join(root, "coverage-store"),
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(warnings).toEqual([
      "Historical main coverage store was configured without an active suite manifest; showing current-run coverage only.",
    ]);
  });

  it("skips artifact dirs without the coverage- prefix", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);
    const ignoredDir = path.join(root, "coverage-artifacts", "unrelated-dir");
    mkdirSync(ignoredDir, { recursive: true });
    writeFileSync(path.join(ignoredDir, "lcov.info"), "TN:\nSF:other/a.mts\nDA:1,1\nend_of_record");

    const { warnings } = await buildCoverageHtml({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: null,
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(warnings[0]).toContain("not configured");
  });

  it("skips artifact dirs that contain no lcov files", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    mkdirSync(path.join(root, "coverage-artifacts", "coverage-empty"), { recursive: true });
    writeArtifact(root, "backend", "backend/a.mts", [[1, 1]]);

    const { warnings } = await buildCoverageHtml({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: null,
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(warnings[0]).toContain("not configured");
  });

  it("accumulates duplicate DA records for the same file and line", async () => {
    const root = tmpRoot();
    const outputDir = path.join(root, "coverage-html");
    const artifactDir = path.join(root, "coverage-artifacts", "coverage-backend");
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(
      path.join(artifactDir, "lcov.info"),
      [
        "TN:",
        "SF:backend/a.mts",
        "DA:1,1",
        "end_of_record",
        "TN:",
        "SF:backend/a.mts",
        "DA:1,2",
      ].join("\n"),
    );

    const { warnings } = await buildCoverageHtml({
      activeSuites: [],
      artifacts: path.join(root, "coverage-artifacts"),
      branch: "main",
      output: outputDir,
      storeFs: null,
      storeS3: null,
      stripPrefixes: [],
    });

    expect(existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(warnings[0]).toContain("not configured");
  });

  it("parses --output, --active-suite, and --strip-prefix flags", () => {
    const args = parseCoverageHtmlArgs([
      "--output",
      "./out",
      "--active-suite",
      "backend",
      "--strip-prefix",
      "/workspace",
    ]);
    expect(args.output).toBe("./out");
    expect(args.activeSuites).toEqual(["backend"]);
    expect(args.stripPrefixes).toEqual(["/workspace"]);
  });
});

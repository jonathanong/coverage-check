import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, runMerge } from "./merge.mts";

describe("main argument validation", () => {
  it("returns 2 on unknown flag", async () => {
    expect(await main(["--unknown-flag"])).toBe(2);
  });

  it("returns 2 when --output is missing", async () => {
    expect(await main(["--artifacts", "/tmp"])).toBe(2);
  });

  it("returns 2 when a flag is missing its value", async () => {
    expect(await main(["--output"])).toBe(2);
  });

  it("returns 2 when --artifacts flag is missing its value", async () => {
    expect(await main(["--artifacts"])).toBe(2);
  });
});

describe("runMerge", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coverage-check-merge-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 1 when no lcov.info files are found", () => {
    const result = runMerge({
      artifacts: join(tmpDir, "empty"),
      output: join(tmpDir, "out/lcov.info"),
      stripPrefixes: [],
      requireArtifacts: [],
    });
    expect(result).toBe(1);
  });

  it("merges multiple lcov.info files and writes output", () => {
    const a = join(tmpDir, "suite-a");
    const b = join(tmpDir, "suite-b");
    mkdirSync(a);
    mkdirSync(b);
    writeFileSync(join(a, "lcov.info"), "SF:src/foo.mts\nDA:1,3\nDA:2,0\nend_of_record\n");
    writeFileSync(join(b, "lcov.info"), "SF:src/foo.mts\nDA:1,2\nDA:3,1\nend_of_record\n");

    const output = join(tmpDir, "merged/lcov.info");
    const result = runMerge({ artifacts: tmpDir, output, stripPrefixes: [], requireArtifacts: [] });
    expect(result).toBe(0);

    const content = readFileSync(output, "utf8");
    expect(content).toContain("SF:src/foo.mts");
    expect(content).toContain("DA:1,5"); // 3+2
    expect(content).toContain("DA:2,0");
    expect(content).toContain("DA:3,1");
    expect(content).toContain("LF:3");
    expect(content).toContain("LH:2");
  });

  it("preserves FN/FNDA/BRDA records through merge", () => {
    const suiteDir = join(tmpDir, "suite");
    mkdirSync(suiteDir);
    const lcov = `SF:src/bar.mts\nFN:5,bar\nFNDA:2,bar\nBRDA:7,0,0,1\nDA:5,2\nend_of_record\n`;
    writeFileSync(join(suiteDir, "lcov.info"), lcov);

    const output = join(tmpDir, "out/lcov.info");
    runMerge({ artifacts: tmpDir, output, stripPrefixes: [], requireArtifacts: [] });

    const content = readFileSync(output, "utf8");
    expect(content).toContain("FN:5,bar");
    expect(content).toContain("FNDA:2,bar");
    expect(content).toContain("BRDA:7,0,0,1");
    expect(content).toContain("FNF:1");
    expect(content).toContain("FNH:1");
    expect(content).toContain("BRF:1");
    expect(content).toContain("BRH:1");
  });

  it("creates parent output directory when it does not exist", () => {
    const suiteDir = join(tmpDir, "suite");
    mkdirSync(suiteDir);
    writeFileSync(join(suiteDir, "lcov.info"), "SF:src/x.mts\nDA:1,1\nend_of_record\n");

    const output = join(tmpDir, "deep/nested/lcov.info");
    expect(runMerge({ artifacts: tmpDir, output, stripPrefixes: [], requireArtifacts: [] })).toBe(
      0,
    );
    expect(readFileSync(output, "utf8")).toContain("SF:src/x.mts");
  });

  it("returns 2 when a required artifact is missing", () => {
    const result = runMerge({
      artifacts: tmpDir,
      output: join(tmpDir, "out/lcov.info"),
      stripPrefixes: [],
      requireArtifacts: ["coverage-missing/lcov.info"],
    });
    expect(result).toBe(2);
  });

  it("returns 0 when required artifact is present and merge succeeds", () => {
    const suiteDir = join(tmpDir, "suite");
    mkdirSync(suiteDir);
    writeFileSync(join(suiteDir, "lcov.info"), "SF:src/x.mts\nDA:1,1\nend_of_record\n");

    const output = join(tmpDir, "out/lcov.info");
    const result = runMerge({
      artifacts: tmpDir,
      output,
      stripPrefixes: [],
      requireArtifacts: ["suite/lcov.info"],
    });
    expect(result).toBe(0);
  });

  it("accepts --strip-prefix via main()", async () => {
    const suiteDir = join(tmpDir, "suite");
    mkdirSync(suiteDir);
    const prefix = "/runner/workspace/";
    writeFileSync(join(suiteDir, "lcov.info"), `SF:${prefix}src/x.mts\nDA:1,1\nend_of_record\n`);
    const output = join(tmpDir, "out/lcov.info");
    const result = await main([
      "--artifacts",
      tmpDir,
      "--output",
      output,
      "--strip-prefix",
      prefix,
    ]);
    expect(result).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("SF:src/x.mts");
  });

  it("accepts --require-artifact via main() when file exists", async () => {
    const suiteDir = join(tmpDir, "suite");
    mkdirSync(suiteDir);
    writeFileSync(join(suiteDir, "lcov.info"), "SF:src/x.mts\nDA:1,1\nend_of_record\n");
    const output = join(tmpDir, "out/lcov.info");
    const result = await main([
      "--artifacts",
      tmpDir,
      "--output",
      output,
      "--require-artifact",
      "suite/lcov.info",
    ]);
    expect(result).toBe(0);
  });
});

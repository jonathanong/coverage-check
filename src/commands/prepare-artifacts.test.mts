import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  main,
  normalizeCoverageArtifacts,
  parsePrepareArtifactsArgs,
  prepareCoverageArtifacts,
} from "./prepare-artifacts.mts";

describe("prepare-artifacts", () => {
  let tmpDir: string;
  let artifactsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coverage-prepare-"));
    artifactsDir = join(tmpDir, "artifacts");
    mkdirSync(artifactsDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("normalizes a single root-level LCOV into the expected suite directory", () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "TN:\n");

    const result = prepareCoverageArtifacts({
      artifacts: artifactsDir,
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
    });

    expect(result.missing).toEqual([]);
    expect(result.message).toContain("coverage-tooling/lcov.info");
    expect(readFileSync(join(artifactsDir, "coverage-tooling", "lcov.info"), "utf8")).toBe("TN:\n");
  });

  it("leaves already nested LCOV files alone", () => {
    mkdirSync(join(artifactsDir, "coverage-web"), { recursive: true });
    writeFileSync(join(artifactsDir, "coverage-web", "lcov.info"), "TN:\n");

    const result = prepareCoverageArtifacts({
      artifacts: artifactsDir,
      expectedSuites: [{ job: "test-web", suite: "web" }],
    });

    expect(result).toEqual({
      message: "Coverage artifact layout already uses named directories.",
      missing: [],
    });
  });

  it("removes duplicate root-level LCOV when named artifacts already exist", () => {
    mkdirSync(join(artifactsDir, "coverage-web"), { recursive: true });
    writeFileSync(join(artifactsDir, "coverage-web", "lcov.info"), "TN:\n");
    writeFileSync(join(artifactsDir, "lcov.info"), "TN:\n");

    const message = normalizeCoverageArtifacts(artifactsDir, [{ job: "test-web", suite: "web" }]);

    expect(message).toContain("Removed duplicate root-level lcov.info");
    expect(existsSync(join(artifactsDir, "lcov.info"))).toBe(false);
  });

  it("removes duplicate root-level LCOV when all expected suite artifacts exist", () => {
    mkdirSync(join(artifactsDir, "coverage-web"), { recursive: true });
    mkdirSync(join(artifactsDir, "coverage-tooling"), { recursive: true });
    writeFileSync(join(artifactsDir, "coverage-web", "lcov.info"), "TN:\n");
    writeFileSync(join(artifactsDir, "coverage-tooling", "lcov.info"), "TN:\n");
    writeFileSync(join(artifactsDir, "lcov.info"), "TN:\n");

    const message = normalizeCoverageArtifacts(artifactsDir, [
      { job: "test-web", suite: "web" },
      { job: "test-tooling", suite: "tooling" },
    ]);

    expect(message).toContain("all expected named coverage artifacts already exist");
    expect(existsSync(join(artifactsDir, "lcov.info"))).toBe(false);
  });

  it("leaves root-level LCOV unchanged when no suites are expected", () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "TN:\n");

    const message = normalizeCoverageArtifacts(artifactsDir, []);

    expect(message).toContain("No expected coverage suites configured");
    expect(readFileSync(join(artifactsDir, "lcov.info"), "utf8")).toBe("TN:\n");
  });

  it("rejects a root-level LCOV when multiple expected suites are missing", () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "TN:\n");

    expect(() =>
      prepareCoverageArtifacts({
        artifacts: artifactsDir,
        expectedSuites: [
          { job: "test-web", suite: "web" },
          { job: "test-tooling", suite: "tooling" },
        ],
      }),
    ).toThrow("exactly one expected coverage suite");
  });

  it("reports missing named LCOV files", () => {
    const result = prepareCoverageArtifacts({
      artifacts: artifactsDir,
      expectedSuites: [{ job: "test-web", suite: "web" }],
    });

    expect(result.missing).toEqual([
      "Missing coverage artifact for test-web: coverage-web/lcov.info",
    ]);
  });

  it("parses --expect-suite pairs", () => {
    expect(
      parsePrepareArtifactsArgs([
        "--artifacts",
        "coverage-artifacts",
        "--expect-suite",
        "test-web=web",
      ]),
    ).toEqual({
      artifacts: "coverage-artifacts",
      expectedSuites: [{ job: "test-web", suite: "web" }],
    });
  });

  it("rejects missing flag values", () => {
    expect(() => parsePrepareArtifactsArgs(["--expect-suite"])).toThrow(
      "--expect-suite requires a value",
    );
  });

  it("rejects unknown flags", () => {
    expect(() => parsePrepareArtifactsArgs(["--unknown"])).toThrow("unknown flag: --unknown");
  });

  it("returns 2 for malformed --expect-suite values", () => {
    expect(main(["--expect-suite", "test-web"])).toBe(2);
  });

  it("prints errors and returns 1 when expected artifacts are missing", () => {
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    });

    expect(main(["--artifacts", artifactsDir, "--expect-suite", "test-web=web"])).toBe(1);
    expect(errors.join("")).toContain("::error::Missing coverage artifact");
  });
});

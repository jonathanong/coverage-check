import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prepareProvenanceArtifacts } from "./provenance-artifacts.mts";
import { COVERAGE_MANIFEST_FILENAME, stampCoverageManifest } from "./provenance.mts";
import type { CoverageArtifactDescriptor } from "./provenance-types.mts";

describe("provenance artifact fan-in", () => {
  let root: string;
  let primary: string;
  let fallback: string;
  let output: string;

  const descriptor: CoverageArtifactDescriptor = {
    suite: "web",
    projects: ["unit"],
    collector: { name: "vitest", settings: { provider: "v8" } },
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "coverage-fan-in-"));
    primary = join(root, "primary");
    fallback = join(root, "fallback");
    output = join(root, "output");
    mkdirSync(join(root, "src"));
    mkdirSync(primary);
    mkdirSync(fallback);
    writeFileSync(join(root, "src", "example.mts"), "export const value = true;\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writePair(parent: string, revision = "a".repeat(40)): string {
    const pairDir = join(parent, "coverage-web");
    mkdirSync(pairDir, { recursive: true });
    const lcovPath = join(pairDir, "lcov.info");
    writeFileSync(lcovPath, "TN:\nSF:src/example.mts\nDA:1,1\nend_of_record\n");
    stampCoverageManifest({
      root,
      lcovPath,
      manifestPath: join(pairDir, COVERAGE_MANIFEST_FILENAME),
      descriptor,
      repository: "example/repository",
      revision,
      run: { id: "123", attempt: 1 },
      collectorVersion: "4.1.0",
    });
    return pairDir;
  }

  function prepare(
    validateSelection?: Parameters<typeof prepareProvenanceArtifacts>[0]["validateSelection"],
  ) {
    return prepareProvenanceArtifacts({
      root,
      sources: [
        { name: "primary", directory: primary },
        { name: "fallback", directory: fallback },
      ],
      outputDirectory: output,
      expectedSuites: [
        {
          producer: "test-web",
          descriptor,
          expectedCollectorVersion: "4.1.0",
        },
      ],
      repository: "example/repository",
      revision: "a".repeat(40),
      expectedRun: { id: "123", currentAttempt: 2 },
      validateSelection,
    });
  }

  it("selects a valid primary pair", () => {
    writePair(primary);

    expect(prepare().selected).toEqual([
      expect.objectContaining({ suite: "web", sources: ["primary"] }),
    ]);
    expect(readFileSync(join(output, "coverage-web", "lcov.info"), "utf8")).toContain(
      "SF:src/example.mts",
    );
  });

  it("uses a valid fallback when the primary pair is invalid", () => {
    const invalid = writePair(primary, "b".repeat(40));
    writePair(fallback);

    expect(prepare().selected[0]?.sources).toEqual(["fallback"]);
    expect(existsSync(join(invalid, "lcov.info"))).toBe(true);
  });

  it("accepts byte-identical pairs from multiple sources", () => {
    const pair = writePair(primary);
    const fallbackPair = join(fallback, "coverage-web");
    mkdirSync(fallbackPair);
    writeFileSync(join(fallbackPair, "lcov.info"), readFileSync(join(pair, "lcov.info")));
    writeFileSync(
      join(fallbackPair, COVERAGE_MANIFEST_FILENAME),
      readFileSync(join(pair, COVERAGE_MANIFEST_FILENAME)),
    );

    expect(prepare().selected[0]?.sources).toEqual(["primary", "fallback"]);
  });

  it("rejects conflicting valid pairs without changing existing output", () => {
    writePair(primary);
    const fallbackPair = writePair(fallback);
    const manifestPath = join(fallbackPair, COVERAGE_MANIFEST_FILENAME);
    writeFileSync(manifestPath, ` \n${readFileSync(manifestPath, "utf8")}`);
    mkdirSync(output);
    writeFileSync(join(output, "sentinel"), "preserved");

    expect(() => prepare()).toThrow("conflicting");
    expect(readFileSync(join(output, "sentinel"), "utf8")).toBe("preserved");
  });

  it("rejects unexpected suites and incomplete pairs", () => {
    mkdirSync(join(primary, "coverage-other"));
    expect(() => prepare()).toThrow("Unexpected");

    rmSync(join(primary, "coverage-other"), { recursive: true });
    mkdirSync(join(primary, "coverage-web"));
    writeFileSync(join(primary, "coverage-web", "lcov.info"), "TN:\n");
    expect(() => prepare()).toThrow("Missing valid coverage artifact");
  });

  it("rejects unexpected non-directory entries", () => {
    writeFileSync(join(primary, "README"), "unexpected");
    expect(() => prepare()).toThrow("Unexpected primary coverage artifact entry");
  });

  it("rejects duplicate expectations and unsafe source names", () => {
    expect(() =>
      prepareProvenanceArtifacts({
        root,
        sources: [{ name: "../primary", directory: primary }],
        outputDirectory: output,
        expectedSuites: [
          { producer: "one", descriptor },
          { producer: "two", descriptor },
        ],
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: null,
      }),
    ).toThrow();

    expect(() =>
      prepareProvenanceArtifacts({
        root,
        sources: [
          { name: "primary", directory: primary },
          { name: "primary", directory: fallback },
        ],
        outputDirectory: output,
        expectedSuites: [{ producer: "one", descriptor }],
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: null,
      }),
    ).toThrow("Duplicate coverage source name");

    expect(() =>
      prepareProvenanceArtifacts({
        root,
        sources: [{ name: "primary", directory: primary }],
        outputDirectory: output,
        expectedSuites: [
          { producer: "one", descriptor },
          { producer: "two", descriptor },
        ],
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: null,
      }),
    ).toThrow("Duplicate expected coverage suite");
  });

  it("runs selection validation before replacing output", () => {
    writePair(primary);
    mkdirSync(output);
    writeFileSync(join(output, "sentinel"), "preserved");

    expect(() =>
      prepare(() => {
        throw new Error("selection policy failed");
      }),
    ).toThrow("selection policy failed");
    expect(readFileSync(join(output, "sentinel"), "utf8")).toBe("preserved");
  });
});

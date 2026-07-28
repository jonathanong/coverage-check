import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COVERAGE_MANIFEST_FILENAME,
  stampCoverageManifest,
  validateCoverageManifest,
} from "./provenance.mts";
import type { CoverageArtifactDescriptor } from "./provenance-types.mts";

describe("coverage provenance identity", () => {
  let root: string;
  let lcovPath: string;
  let manifestPath: string;
  const descriptor: CoverageArtifactDescriptor = {
    suite: "web",
    projects: ["unit"],
    collector: { name: "vitest", settings: { provider: "v8" } },
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "coverage-identity-"));
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "coverage"));
    writeFileSync(join(root, "src", "example.mts"), "export const answer = 42;\n");
    lcovPath = join(root, "coverage", "lcov.info");
    manifestPath = join(root, "coverage", COVERAGE_MANIFEST_FILENAME);
    writeFileSync(lcovPath, "TN:\nSF:src/example.mts\nDA:1,1\nend_of_record\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function stamp(runId = "123"): void {
    stampCoverageManifest({
      root,
      lcovPath,
      manifestPath,
      descriptor,
      repository: "example/repository",
      revision: "a".repeat(40),
      run: { id: runId, attempt: 2 },
      collectorVersion: "4.1.0",
    });
  }

  function validate(overrides: Partial<Parameters<typeof validateCoverageManifest>[0]> = {}): void {
    validateCoverageManifest({
      root,
      lcovPath,
      manifestPath,
      descriptor,
      repository: "example/repository",
      revision: "a".repeat(40),
      expectedRun: { id: "123", currentAttempt: 2 },
      ...overrides,
    });
  }

  it("rejects repository and collector-version mismatches independently", () => {
    stamp();
    expect(() => validate({ repository: "other/repository" })).toThrow("identity");
    expect(() => validate({ expectedCollectorVersion: "5.0.0" })).toThrow("identity");
  });

  it("rejects wrong run IDs and future attempts independently", () => {
    stamp();
    expect(() => validate({ expectedRun: { id: "different-run", currentAttempt: 2 } })).toThrow(
      "current CI run",
    );
    expect(() => validate({ expectedRun: { id: "123", currentAttempt: 1 } })).toThrow(
      "current CI run",
    );
  });

  it("supports opaque run IDs and distinguishes local manifests", () => {
    stamp("build/uuid:abc-123");
    expect(() =>
      validate({ expectedRun: { id: "build/uuid:abc-123", currentAttempt: 2 } }),
    ).not.toThrow();
    expect(() => validate({ expectedRun: null })).toThrow("not a local run");
  });

  it("rejects invalid runtime descriptor values before mutating LCOV", () => {
    const originalLcov = readFileSync(lcovPath);
    const invalidDescriptors = [
      null,
      { ...descriptor, suite: 42 },
      { ...descriptor, projects: [] },
      { ...descriptor, projects: [42] },
      { ...descriptor, collector: { ...descriptor.collector, name: null } },
      { ...descriptor, collector: { ...descriptor.collector, settings: [] } },
    ];

    for (const invalidDescriptor of invalidDescriptors) {
      expect(() =>
        stampCoverageManifest({
          root,
          lcovPath,
          manifestPath,
          descriptor: invalidDescriptor as unknown as CoverageArtifactDescriptor,
          repository: "example/repository",
          revision: "a".repeat(40),
          run: null,
          collectorVersion: "4.1.0",
        }),
      ).toThrow();
      expect(readFileSync(lcovPath)).toEqual(originalLcov);
    }
  });

  it("rejects invalid revision, repository, run, and expected-run inputs", () => {
    const base = {
      root,
      lcovPath,
      manifestPath,
      descriptor,
      repository: "example/repository",
      revision: "a".repeat(40),
      run: null,
      collectorVersion: "4.1.0",
    } as const;

    expect(() => stampCoverageManifest({ ...base, revision: "not-a-sha" })).toThrow(
      "40-character SHA",
    );
    expect(() => stampCoverageManifest({ ...base, repository: "" })).toThrow(
      "repository is required",
    );
    expect(() => stampCoverageManifest({ ...base, run: { id: "", attempt: 0 } })).toThrow(
      "attempt must be a positive integer",
    );

    stamp();
    expect(() => validate({ expectedRun: { id: "", currentAttempt: 0 } })).toThrow(
      "Expected coverage run",
    );
  });
});

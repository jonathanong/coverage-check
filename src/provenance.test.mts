import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COVERAGE_MANIFEST_FILENAME,
  parseCoverageManifest,
  stampCoverageManifest,
  validateCoverageManifest,
} from "./provenance.mts";
import type { CoverageArtifactDescriptor } from "./provenance-types.mts";

describe("coverage artifact provenance", () => {
  let root: string;
  let coverageDir: string;
  let lcovPath: string;
  let manifestPath: string;

  const descriptor: CoverageArtifactDescriptor = {
    suite: "web",
    projects: ["unit", "integration"],
    collector: { name: "vitest", settings: { branches: true, provider: "v8" } },
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "coverage-provenance-"));
    coverageDir = join(root, "coverage");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(coverageDir);
    writeFileSync(join(root, "src", "example.mts"), "export const answer = 42;\n");
    lcovPath = join(coverageDir, "lcov.info");
    manifestPath = join(coverageDir, COVERAGE_MANIFEST_FILENAME);
    writeFileSync(lcovPath, `TN:\nSF:${join(root, "src", "example.mts")}\nDA:1,1\nend_of_record\n`);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function stamp(
    run: Parameters<typeof stampCoverageManifest>[0]["run"] = { id: "123", attempt: 2 },
  ): void {
    stampCoverageManifest({
      root,
      lcovPath,
      manifestPath,
      descriptor,
      repository: "example/repository",
      revision: "a".repeat(40),
      run,
      collectorVersion: "4.1.0",
    });
  }

  it("normalizes LCOV paths, writes deterministic manifest bytes, and validates them", () => {
    stamp();

    expect(readFileSync(lcovPath, "utf8")).toContain("SF:src/example.mts");
    const firstBytes = readFileSync(manifestPath, "utf8");
    stamp();
    expect(readFileSync(manifestPath, "utf8")).toBe(firstBytes);
    expect(
      validateCoverageManifest({
        root,
        lcovPath,
        manifestPath,
        descriptor,
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: { id: "123", currentAttempt: 3 },
        expectedCollectorVersion: "4.1.0",
      }),
    ).toMatchObject({ suite: "web", projects: ["unit", "integration"] });
  });

  it("rejects LCOV tampering after stamping", () => {
    stamp();
    writeFileSync(lcovPath, `${readFileSync(lcovPath, "utf8")}TN:tampered\n`);

    expect(() =>
      validateCoverageManifest({
        root,
        lcovPath,
        manifestPath,
        descriptor,
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: { id: "123", currentAttempt: 2 },
      }),
    ).toThrow("LCOV integrity");
  });

  it("rejects source-content changes after stamping", () => {
    stamp();
    writeFileSync(join(root, "src", "example.mts"), "export const answer = 7;\n");

    expect(() =>
      validateCoverageManifest({
        root,
        lcovPath,
        manifestPath,
        descriptor,
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: { id: "123", currentAttempt: 2 },
      }),
    ).toThrow("source-root integrity");
  });

  it("rejects malformed schemas and extra keys", () => {
    stamp();
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;

    expect(() => parseCoverageManifest(null)).toThrow("must be an object");
    expect(() => parseCoverageManifest({ ...manifest, unexpected: true })).toThrow(
      "unsupported schema",
    );
    const { collector, ...withoutCollector } = manifest;
    expect(() => parseCoverageManifest({ ...withoutCollector, collectar: collector })).toThrow(
      "unsupported schema",
    );
    expect(() => parseCoverageManifest({ ...manifest, projects: [] })).toThrow(
      "unsupported schema",
    );
    for (const collectorValue of [null, "invalid", []]) {
      expect(() => parseCoverageManifest({ ...manifest, collector: collectorValue })).toThrow(
        "unsupported schema",
      );
    }
    expect(() =>
      parseCoverageManifest({
        ...manifest,
        lcov: { ...(manifest["lcov"] as Record<string, unknown>), sha256: "invalid" },
      }),
    ).toThrow("unsupported schema");
  });

  it("rejects empty, escaping, and Windows drive-letter source paths", () => {
    for (const source of ["", "../outside.mts", "C:\\outside.mts"]) {
      writeFileSync(lcovPath, `TN:\nSF:${source}\nDA:1,1\nend_of_record\n`);
      expect(() => stamp()).toThrow();
    }
  });

  it("treats CRLF and LF source bytes equivalently", () => {
    writeFileSync(join(root, "src", "example.mts"), "one\r\ntwo\r\n");
    stamp();
    writeFileSync(join(root, "src", "example.mts"), "one\ntwo\n");

    expect(() =>
      validateCoverageManifest({
        root,
        lcovPath,
        manifestPath,
        descriptor,
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: { id: "123", currentAttempt: 2 },
      }),
    ).not.toThrow();
  });

  it("normalizes CRLF LCOV records", () => {
    writeFileSync(lcovPath, "TN:\r\nSF:src/example.mts\r\nDA:1,1\r\nend_of_record\r\n");

    expect(() => stamp()).not.toThrow();
    expect(readFileSync(lcovPath, "utf8")).toBe("TN:\nSF:src/example.mts\nDA:1,1\nend_of_record\n");
  });

  it("rejects empty LCOV and existing sources outside the repository root", () => {
    writeFileSync(lcovPath, "TN:\n");
    expect(() => stamp()).toThrow("at least one valid source");

    const outsideRoot = mkdtempSync(join(tmpdir(), "coverage-outside-"));
    try {
      const outsideSource = join(outsideRoot, "outside.mts");
      writeFileSync(outsideSource, "export const outside = true;\n");
      writeFileSync(lcovPath, `TN:\nSF:${outsideSource}\nDA:1,1\nend_of_record\n`);
      expect(() => stamp()).toThrow("escapes repository root");
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rejects symlink and directory LCOV sources", () => {
    const invalidSource = join(root, "src", "invalid.mts");
    symlinkSync(join(root, "src", "example.mts"), invalidSource);
    writeFileSync(lcovPath, "TN:\nSF:src/invalid.mts\nDA:1,1\nend_of_record\n");
    expect(() => stamp()).toThrow("must not be a symlink");

    rmSync(invalidSource);
    mkdirSync(invalidSource);
    expect(() => stamp()).toThrow("not a regular file");
  });

  it("accepts a local manifest when a local run is expected", () => {
    stamp(null);

    expect(() =>
      validateCoverageManifest({
        root,
        lcovPath,
        manifestPath,
        descriptor,
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: null,
      }),
    ).not.toThrow();
  });

  it("rejects a local manifest when a CI run is expected", () => {
    stamp(null);

    expect(() =>
      validateCoverageManifest({
        root,
        lcovPath,
        manifestPath,
        descriptor,
        repository: "example/repository",
        revision: "a".repeat(40),
        expectedRun: { id: "123", currentAttempt: 2 },
      }),
    ).toThrow("current CI run");
  });

  it("hashes multiple represented sources in stable path order", () => {
    writeFileSync(join(root, "src", "another.mts"), "export const another = true;\n");
    writeFileSync(
      lcovPath,
      "TN:\nSF:src/example.mts\nDA:1,1\nend_of_record\nTN:\nSF:src/another.mts\nDA:1,1\nend_of_record\n",
    );

    stamp();
    const first = parseCoverageManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);

    writeFileSync(
      lcovPath,
      "TN:\nSF:src/another.mts\nDA:1,1\nend_of_record\nTN:\nSF:src/example.mts\nDA:1,1\nend_of_record\n",
    );
    stamp();
    const second = parseCoverageManifest(JSON.parse(readFileSync(manifestPath, "utf8")) as unknown);

    expect(second.sourceRoot.sha256).toBe(first.sourceRoot.sha256);
  });
});

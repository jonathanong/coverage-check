import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COVERAGE_MANIFEST_FILENAME, stampCoverageManifest } from "./provenance.mts";
import type { CoverageRun } from "./provenance-types.mts";
import { pruneStaleEarlierAttemptSuites } from "./stale-attempt-prune.mts";

const repository = "example/repository";
const revision = "a".repeat(40);
const run = { id: "1234", currentAttempt: 2 } as const;

describe("pruneStaleEarlierAttemptSuites", () => {
  let root: string;
  const extraDirs: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "coverage-stale-prune-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "example.mts"), "export const value = true;\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    for (const directory of extraDirs) rmSync(directory, { recursive: true, force: true });
    extraDirs.length = 0;
  });

  function sourceRoot(): string {
    const directory = mkdtempSync(join(tmpdir(), "coverage-stale-source-"));
    extraDirs.push(directory);
    return directory;
  }

  function writeSuite(directory: string, suite: string, manifestRun: CoverageRun | null): string {
    const pairDir = join(directory, `coverage-${suite}`);
    mkdirSync(pairDir, { recursive: true });
    const lcovPath = join(pairDir, "lcov.info");
    writeFileSync(lcovPath, "TN:\nSF:src/example.mts\nDA:1,1\nLF:1\nLH:1\nend_of_record\n");
    stampCoverageManifest({
      root,
      lcovPath,
      manifestPath: join(pairDir, COVERAGE_MANIFEST_FILENAME),
      descriptor: {
        suite,
        projects: ["src"],
        collector: { name: "vitest-v8", settings: { provider: "v8" } },
      },
      repository,
      revision,
      run: manifestRun,
      collectorVersion: "4.1.10",
    });
    return pairDir;
  }

  it.each(["primary", "fallback"] as const)(
    "prunes a stale earlier-attempt unexpected suite from the %s root and names it in a notice",
    (name) => {
      const directory = sourceRoot();
      writeSuite(directory, "tooling", { id: run.id, attempt: 2 });
      const stale = writeSuite(directory, "portability-linux", { id: run.id, attempt: 1 });
      const notice = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      const pruned = pruneStaleEarlierAttemptSuites({
        sources: [{ name, directory }],
        expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
        run,
      });

      expect(pruned).toEqual(["portability-linux"]);
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(join(directory, "coverage-tooling"))).toBe(true);
      expect(notice.mock.calls).toHaveLength(1);
      expect(String(notice.mock.calls[0]?.[0])).toMatch(/^::notice::.*portability-linux/);
      notice.mockRestore();
    },
  );

  it("keeps an unexpected suite stamped with a foreign run id", () => {
    const directory = sourceRoot();
    const foreign = writeSuite(directory, "portability-linux", { id: "9999", attempt: 1 });

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [{ name: "primary", directory }],
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
      run,
    });

    expect(pruned).toEqual([]);
    expect(existsSync(foreign)).toBe(true);
  });

  it("keeps an unexpected suite stamped with the current attempt", () => {
    const directory = sourceRoot();
    const current = writeSuite(directory, "portability-linux", { id: run.id, attempt: 2 });

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [{ name: "primary", directory }],
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
      run,
    });

    expect(pruned).toEqual([]);
    expect(existsSync(current)).toBe(true);
  });

  it("keeps an unexpected suite stamped with run: null", () => {
    const directory = sourceRoot();
    const local = writeSuite(directory, "portability-linux", null);

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [{ name: "primary", directory }],
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
      run,
    });

    expect(pruned).toEqual([]);
    expect(existsSync(local)).toBe(true);
  });

  it("keeps an unexpected suite with a missing manifest", () => {
    const directory = sourceRoot();
    const pairDir = join(directory, "coverage-portability-linux");
    mkdirSync(pairDir, { recursive: true });
    writeFileSync(join(pairDir, "lcov.info"), "TN:\n");

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [{ name: "primary", directory }],
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
      run,
    });

    expect(pruned).toEqual([]);
    expect(existsSync(pairDir)).toBe(true);
  });

  it("keeps an unexpected suite with a malformed manifest", () => {
    const directory = sourceRoot();
    const pairDir = join(directory, "coverage-portability-linux");
    mkdirSync(pairDir, { recursive: true });
    writeFileSync(join(pairDir, "lcov.info"), "TN:\n");
    writeFileSync(join(pairDir, COVERAGE_MANIFEST_FILENAME), "not json");

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [{ name: "primary", directory }],
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
      run,
    });

    expect(pruned).toEqual([]);
    expect(existsSync(pairDir)).toBe(true);
  });

  it("does not touch entries that are not coverage-<suite> directories", () => {
    const directory = sourceRoot();
    writeFileSync(join(directory, "stray.txt"), "stray");
    mkdirSync(join(directory, "other-dir"));
    writeFileSync(join(directory, "coverage-not-a-dir"), "file");
    writeFileSync(join(directory, COVERAGE_MANIFEST_FILENAME), "not json");
    writeFileSync(join(directory, "lcov.info"), "TN:\n");

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [{ name: "fallback", directory }],
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
      run,
    });

    expect(pruned).toEqual([]);
    expect(existsSync(join(directory, "stray.txt"))).toBe(true);
    expect(existsSync(join(directory, "other-dir"))).toBe(true);
    expect(existsSync(join(directory, "coverage-not-a-dir"))).toBe(true);
    expect(existsSync(join(directory, COVERAGE_MANIFEST_FILENAME))).toBe(true);
    expect(existsSync(join(directory, "lcov.info"))).toBe(true);
  });

  it("prunes nothing and emits no notices when every present suite is expected", () => {
    const directory = sourceRoot();
    writeSuite(directory, "tooling", { id: run.id, attempt: 1 });
    const notice = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [{ name: "primary", directory }],
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
      run,
    });

    expect(pruned).toEqual([]);
    expect(notice.mock.calls).toHaveLength(0);
    notice.mockRestore();
  });

  it("skips a missing source directory and a path that is not a directory", () => {
    const missing = join(root, "does-not-exist");
    const notADirectory = join(root, "source-is-a-file");
    writeFileSync(notADirectory, "not a directory");

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [
        { name: "primary", directory: missing },
        { name: "fallback", directory: notADirectory },
      ],
      expectedSuites: [{ job: "test-tooling", suite: "tooling" }],
      run,
    });

    expect(pruned).toEqual([]);
  });

  it("reproduces a narrowed later-attempt selection across primary and fallback", () => {
    const primary = sourceRoot();
    const fallback = sourceRoot();
    for (const directory of [primary, fallback]) {
      writeSuite(directory, "tooling", { id: run.id, attempt: 2 });
      writeSuite(directory, "portability-macos", { id: run.id, attempt: 2 });
      writeSuite(directory, "portability-linux", { id: run.id, attempt: 1 });
    }
    const expectedSuites = [
      { job: "test-tooling", suite: "tooling" },
      { job: "test-portability", suite: "portability-macos" },
    ];

    const pruned = pruneStaleEarlierAttemptSuites({
      sources: [
        { name: "primary", directory: primary },
        { name: "fallback", directory: fallback },
      ],
      expectedSuites,
      run,
    });

    expect(pruned).toEqual(["portability-linux", "portability-linux"]);
    for (const directory of [primary, fallback]) {
      expect(existsSync(join(directory, "coverage-portability-linux"))).toBe(false);
      expect(existsSync(join(directory, "coverage-tooling"))).toBe(true);
      expect(existsSync(join(directory, "coverage-portability-macos"))).toBe(true);
    }
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectLcovFiles, buildStripPrefixes } from "./load-artifacts.mts";

describe("collectLcovFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "load-artifacts-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array for missing directory (ENOENT silenced)", () => {
    expect(collectLcovFiles(join(tmpDir, "nonexistent"))).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    expect(collectLcovFiles(tmpDir)).toEqual([]);
  });

  it("finds lcov.info at the top level", () => {
    writeFileSync(join(tmpDir, "lcov.info"), "");
    const results = collectLcovFiles(tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0]).toContain("lcov.info");
  });

  it("ignores non-lcov.info files", () => {
    writeFileSync(join(tmpDir, "coverage.json"), "");
    writeFileSync(join(tmpDir, "lcov.txt"), "");
    expect(collectLcovFiles(tmpDir)).toHaveLength(0);
  });

  it("recursively finds lcov.info in subdirectories", () => {
    const sub1 = join(tmpDir, "backend");
    const sub2 = join(tmpDir, "backend", "nested");
    mkdirSync(sub2, { recursive: true });
    writeFileSync(join(sub1, "lcov.info"), "");
    writeFileSync(join(sub2, "lcov.info"), "");
    const results = collectLcovFiles(tmpDir);
    expect(results).toHaveLength(2);
  });

  it("finds lcov.info in hidden artifact directories", () => {
    const hidden = join(tmpDir, ".coverage", "nested");
    mkdirSync(hidden, { recursive: true });
    writeFileSync(join(hidden, "lcov.info"), "");
    expect(collectLcovFiles(tmpDir)).toEqual([join(hidden, "lcov.info")]);
  });

  it("finds lcov.info in multiple sibling subdirectories", () => {
    mkdirSync(join(tmpDir, "backend"));
    mkdirSync(join(tmpDir, "frontend"));
    writeFileSync(join(tmpDir, "backend", "lcov.info"), "");
    writeFileSync(join(tmpDir, "frontend", "lcov.info"), "");
    expect(collectLcovFiles(tmpDir)).toHaveLength(2);
  });
});

describe("buildStripPrefixes", () => {
  it("always includes cwd as a suffix-slash prefix", () => {
    const prefixes = buildStripPrefixes();
    const cwd = process.cwd();
    const expected = cwd.endsWith("/") ? cwd : `${cwd}/`;
    expect(prefixes).toContain(expected);
  });

  it("includes GITHUB_WORKSPACE when set", () => {
    const origWs = process.env["GITHUB_WORKSPACE"];
    process.env["GITHUB_WORKSPACE"] = "/home/runner/work/repo";
    try {
      const prefixes = buildStripPrefixes();
      expect(prefixes.some((p) => p.startsWith("/home/runner/work/repo"))).toBe(true);
    } finally {
      if (origWs === undefined) {
        delete process.env["GITHUB_WORKSPACE"];
      } else {
        process.env["GITHUB_WORKSPACE"] = origWs;
      }
    }
  });

  it("does not include github workspace prefix when env var is absent", () => {
    const origWs = process.env["GITHUB_WORKSPACE"];
    delete process.env["GITHUB_WORKSPACE"];
    try {
      const prefixes = buildStripPrefixes();
      // Only cwd and extra prefixes should be present
      expect(prefixes).toHaveLength(1);
    } finally {
      if (origWs !== undefined) {
        process.env["GITHUB_WORKSPACE"] = origWs;
      }
    }
  });

  it("normalizes extra prefixes to end with /", () => {
    const prefixes = buildStripPrefixes(["/some/path", "/other/path/"]);
    expect(prefixes[0]).toBe("/some/path/");
    expect(prefixes[1]).toBe("/other/path/");
  });

  it("includes GITHUB_WORKSPACE with trailing slash when it already ends with /", () => {
    const origWs = process.env["GITHUB_WORKSPACE"];
    process.env["GITHUB_WORKSPACE"] = "/home/runner/work/repo/";
    try {
      const prefixes = buildStripPrefixes();
      expect(prefixes.some((p) => p === "/home/runner/work/repo/")).toBe(true);
    } finally {
      if (origWs === undefined) {
        delete process.env["GITHUB_WORKSPACE"];
      } else {
        process.env["GITHUB_WORKSPACE"] = origWs;
      }
    }
  });
});

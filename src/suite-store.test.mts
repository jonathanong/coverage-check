import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemSuiteStore } from "./suite-store.mts";

describe("FileSystemSuiteStore", () => {
  let tmpDir: string;
  let store: FileSystemSuiteStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "suite-store-"));
    store = new FileSystemSuiteStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("list()", () => {
    it("returns empty array when store root does not exist", async () => {
      const missing = new FileSystemSuiteStore(join(tmpDir, "nonexistent"));
      expect(await missing.list()).toEqual([]);
    });

    it("returns empty array for an empty store", async () => {
      expect(await store.list()).toEqual([]);
    });

    it("returns suite names after putting suites", async () => {
      await store.put("backend", Buffer.from("SF:foo\nend_of_record\n"));
      await store.put("frontend", Buffer.from("SF:bar\nend_of_record\n"));
      const suites = await store.list();
      expect(suites).toContain("backend");
      expect(suites).toContain("frontend");
      expect(suites).toHaveLength(2);
    });

    it("ignores non-directory entries in the root", async () => {
      await store.put("backend", Buffer.from("SF:foo\nend_of_record\n"));
      // The lcov.info inside backend dir should not appear as a suite
      const suites = await store.list();
      expect(suites).not.toContain("lcov.info");
      expect(suites).not.toContain("meta.json");
    });

    it("rethrows non-ENOENT errors", async () => {
      const badStore = new FileSystemSuiteStore("\0invalid");
      await expect(badStore.list()).rejects.toThrow();
    });
  });

  describe("get()", () => {
    it("returns null for a missing suite", async () => {
      expect(await store.get("nonexistent")).toBeNull();
    });

    it("returns the LCOV buffer after put()", async () => {
      const lcov = Buffer.from("SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
      await store.put("backend", lcov);
      const result = await store.get("backend");
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe(lcov.toString());
    });

    it("rethrows non-ENOENT errors from readFileSync", async () => {
      const badStore = new FileSystemSuiteStore("\0invalid");
      await expect(badStore.get("suite")).rejects.toThrow();
    });
  });

  describe("put()", () => {
    it("writes lcov.info and meta.json", async () => {
      const lcov = Buffer.from("SF:foo.mts\nDA:1,5\nend_of_record\n");
      await store.put("backend", lcov, { sha: "abc123", ref: "refs/heads/main" });

      const lcovPath = join(tmpDir, "backend", "lcov.info");
      const metaPath = join(tmpDir, "backend", "meta.json");
      expect(readFileSync(lcovPath).toString()).toBe(lcov.toString());

      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      expect(meta.sha).toBe("abc123");
      expect(meta.ref).toBe("refs/heads/main");
      expect(typeof meta.timestamp).toBe("string");
    });

    it("uses the provided timestamp in meta.json", async () => {
      await store.put("backend", Buffer.from(""), { timestamp: "2026-01-01T00:00:00.000Z" });
      const meta = JSON.parse(readFileSync(join(tmpDir, "backend", "meta.json"), "utf8"));
      expect(meta.timestamp).toBe("2026-01-01T00:00:00.000Z");
    });

    it("creates a default timestamp when none is provided", async () => {
      const before = new Date().toISOString();
      await store.put("backend", Buffer.from(""));
      const meta = JSON.parse(readFileSync(join(tmpDir, "backend", "meta.json"), "utf8"));
      const after = new Date().toISOString();
      expect(meta.timestamp >= before).toBe(true);
      expect(meta.timestamp <= after).toBe(true);
    });

    it("creates parent directories recursively", async () => {
      const nested = new FileSystemSuiteStore(join(tmpDir, "deep", "nested", "store"));
      await nested.put("backend", Buffer.from("SF:foo\nend_of_record\n"));
      expect(await nested.list()).toContain("backend");
    });

    it("overwrites an existing suite", async () => {
      await store.put("backend", Buffer.from("v1"));
      await store.put("backend", Buffer.from("v2"));
      const result = await store.get("backend");
      expect(result!.toString()).toBe("v2");
    });
  });
});

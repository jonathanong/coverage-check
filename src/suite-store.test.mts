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
      await store.put("backend", Buffer.from("SF:foo\nend_of_record\n"), {
        sha: "abc",
        branch: "main",
      });
      await store.put("frontend", Buffer.from("SF:bar\nend_of_record\n"), {
        sha: "def",
        branch: "main",
      });
      const suites = await store.list();
      expect(suites).toContain("backend");
      expect(suites).toContain("frontend");
      expect(suites).toHaveLength(2);
    });

    it("ignores non-directory entries in the root", async () => {
      await store.put("backend", Buffer.from("SF:foo\nend_of_record\n"), {
        sha: "abc",
        branch: "main",
      });
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
    it("returns null for a missing suite (no pointer file)", async () => {
      expect(await store.get("nonexistent")).toBeNull();
    });

    it("returns null when get() is called with explicit sha that has no lcov file", async () => {
      // Pointer exists (from a different sha), but requested sha is absent
      await store.put("backend", Buffer.from("SF:backend/foo.mts\nDA:1,1\nend_of_record\n"), {
        sha: "abc",
        branch: "main",
      });
      expect(await store.get("backend", { sha: "nonexistent-sha" })).toBeNull();
    });

    it("returns the LCOV buffer after put() via branch pointer", async () => {
      const lcov = Buffer.from("SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
      await store.put("backend", lcov, { sha: "abc123", branch: "main" });
      const result = await store.get("backend");
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe(lcov.toString());
    });

    it("returns the LCOV buffer when get() is called with explicit sha", async () => {
      const lcov = Buffer.from("SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
      await store.put("backend", lcov, { sha: "abc123", branch: "main" });
      const result = await store.get("backend", { sha: "abc123" });
      expect(result).not.toBeNull();
      expect(result!.toString()).toBe(lcov.toString());
    });

    it("resolves the correct sha via the branch pointer", async () => {
      const lcovV1 = Buffer.from("SF:backend/v1.mts\nDA:1,1\nend_of_record\n");
      const lcovV2 = Buffer.from("SF:backend/v2.mts\nDA:2,1\nend_of_record\n");
      await store.put("backend", lcovV1, { sha: "sha1", branch: "main" });
      await store.put("backend", lcovV2, { sha: "sha2", branch: "main" });
      // Branch pointer now points to sha2; sha1 still exists on disk
      const result = await store.get("backend", { branch: "main" });
      expect(result!.toString()).toBe(lcovV2.toString());
    });

    it("rethrows non-ENOENT errors from pointer readFileSync", async () => {
      const badStore = new FileSystemSuiteStore("\0invalid");
      await expect(badStore.get("suite")).rejects.toThrow();
    });

    it("rethrows non-ENOENT errors from lcov readFileSync when sha is explicit", async () => {
      const badStore = new FileSystemSuiteStore("\0invalid");
      await expect(badStore.get("suite", { sha: "abc" })).rejects.toThrow();
    });
  });

  describe("put()", () => {
    it("writes lcov.info under sha/ and latest.json under branch/", async () => {
      const lcov = Buffer.from("SF:foo.mts\nDA:1,5\nend_of_record\n");
      await store.put("backend", lcov, { sha: "abc123", branch: "main" });

      const lcovPath = join(tmpDir, "backend", "sha", "abc123", "lcov.info");
      const pointerPath = join(tmpDir, "backend", "branch", "main", "latest.json");
      expect(readFileSync(lcovPath).toString()).toBe(lcov.toString());

      const pointer = JSON.parse(readFileSync(pointerPath, "utf8"));
      expect(pointer.sha).toBe("abc123");
      expect(typeof pointer.timestamp).toBe("string");
    });

    it("uses the provided timestamp", async () => {
      await store.put("backend", Buffer.from(""), {
        sha: "abc",
        branch: "main",
        timestamp: "2026-01-01T00:00:00.000Z",
      });
      const pointer = JSON.parse(
        readFileSync(join(tmpDir, "backend", "branch", "main", "latest.json"), "utf8"),
      );
      expect(pointer.timestamp).toBe("2026-01-01T00:00:00.000Z");
    });

    it("creates a default timestamp when none is provided", async () => {
      const before = new Date().toISOString();
      await store.put("backend", Buffer.from(""), { sha: "abc", branch: "main" });
      const after = new Date().toISOString();
      const pointer = JSON.parse(
        readFileSync(join(tmpDir, "backend", "branch", "main", "latest.json"), "utf8"),
      );
      expect(pointer.timestamp >= before).toBe(true);
      expect(pointer.timestamp <= after).toBe(true);
    });

    it("creates parent directories recursively", async () => {
      const nested = new FileSystemSuiteStore(join(tmpDir, "deep", "nested", "store"));
      await nested.put("backend", Buffer.from("SF:foo\nend_of_record\n"), {
        sha: "abc",
        branch: "main",
      });
      expect(await nested.list()).toContain("backend");
    });

    it("overwrites an existing suite when same sha is used", async () => {
      await store.put("backend", Buffer.from("v1"), { sha: "abc", branch: "main" });
      await store.put("backend", Buffer.from("v2"), { sha: "abc", branch: "main" });
      const result = await store.get("backend", { sha: "abc" });
      expect(result!.toString()).toBe("v2");
    });

    it("keeps multiple sha entries independently", async () => {
      await store.put("backend", Buffer.from("v1"), { sha: "sha1", branch: "main" });
      await store.put("backend", Buffer.from("v2"), { sha: "sha2", branch: "main" });
      expect((await store.get("backend", { sha: "sha1" }))!.toString()).toBe("v1");
      expect((await store.get("backend", { sha: "sha2" }))!.toString()).toBe("v2");
    });
  });

  describe("path traversal protection", () => {
    const invalid = ["", ".", "..", "a/b", "a\\b"];
    for (const val of invalid) {
      it(`get() rejects suite=${JSON.stringify(val)}`, async () => {
        await expect(store.get(val)).rejects.toThrow("invalid suite");
      });
      it(`get() rejects branch=${JSON.stringify(val)}`, async () => {
        await expect(store.get("backend", { branch: val })).rejects.toThrow("invalid branch");
      });
      it(`get() rejects sha=${JSON.stringify(val)}`, async () => {
        await expect(store.get("backend", { sha: val })).rejects.toThrow("invalid sha");
      });
      it(`put() rejects suite=${JSON.stringify(val)}`, async () => {
        await expect(
          store.put(val, Buffer.from(""), { sha: "abc", branch: "main" }),
        ).rejects.toThrow("invalid suite");
      });
      it(`put() rejects sha=${JSON.stringify(val)}`, async () => {
        await expect(
          store.put("backend", Buffer.from(""), { sha: val, branch: "main" }),
        ).rejects.toThrow("invalid sha");
      });
      it(`put() rejects branch=${JSON.stringify(val)}`, async () => {
        await expect(
          store.put("backend", Buffer.from(""), { sha: "abc", branch: val }),
        ).rejects.toThrow("invalid branch");
      });
    }
  });
});

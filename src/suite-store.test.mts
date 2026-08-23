import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafePathComponent,
  assertValidRepo,
  decodeBranchName,
  encodeBranchName,
  FileSystemSuiteStore,
  isNewerTimestamp,
} from "./suite-store.mts";
import {
  baselineSnapshotObjectName,
  baselineSnapshotPayloadObjectName,
  createBaselineSnapshot,
  hashBaselineSnapshotPayload,
} from "./baseline-snapshot.mts";

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

    it("does not expose root-level snapshot metadata as a suite", async () => {
      const snapshot = createBaselineSnapshot("key", "main", []);
      await store.putBaselineSnapshotIfAbsent("key", snapshot);
      expect(await store.list()).not.toContain(baselineSnapshotObjectName("key"));
    });
  });

  describe("baseline snapshots", () => {
    it("resolves versioned, legacy, and absent suites", async () => {
      await store.put("versioned", Buffer.from("versioned"), { sha: "abc", branch: "main" });
      await store.put("legacy", Buffer.from("legacy"));

      expect(await store.resolveVersion("versioned", "main")).toEqual({
        kind: "sha",
        sha: "abc",
      });
      expect(await store.resolveVersion("legacy", "main")).toEqual({ kind: "legacy" });
      expect(await store.resolveVersion("missing", "main")).toBeNull();
    });

    it("atomically keeps the first snapshot for a key", async () => {
      const firstPayloadHash = hashBaselineSnapshotPayload(Buffer.from("one"));
      const secondPayloadHash = hashBaselineSnapshotPayload(Buffer.from("two"));
      const first = createBaselineSnapshot("key", "main", [
        { suite: "backend", sha: "one", payloadHash: firstPayloadHash },
      ]);
      const second = createBaselineSnapshot("key", "main", [
        { suite: "backend", sha: "two", payloadHash: secondPayloadHash },
      ]);

      expect(await store.putBaselineSnapshotIfAbsent("key", first)).toMatchObject({
        created: true,
        snapshot: first,
      });
      expect(await store.putBaselineSnapshotIfAbsent("key", second)).toMatchObject({
        created: false,
        snapshot: first,
      });
      expect(await store.readBaselineSnapshot("key")).toEqual(first);
      expect(await store.readBaselineSnapshot("missing")).toBeNull();
    });

    it("stores immutable snapshot payloads by content hash", async () => {
      const payload = Buffer.from("baseline");
      const payloadHash = hashBaselineSnapshotPayload(payload);
      await store.putBaselineSnapshotPayloadIfAbsent(payloadHash, payload);
      await store.putBaselineSnapshotPayloadIfAbsent(payloadHash, Buffer.from("baseline"));

      expect(await store.readBaselineSnapshotPayload(payloadHash)).toEqual(payload);
      expect(readFileSync(join(tmpDir, baselineSnapshotPayloadObjectName(payloadHash)))).toEqual(
        payload,
      );
      await expect(
        store.putBaselineSnapshotPayloadIfAbsent(payloadHash, Buffer.from("replacement")),
      ).rejects.toThrow("content hash");
      expect(
        await store.readBaselineSnapshotPayload(
          hashBaselineSnapshotPayload(Buffer.from("missing")),
        ),
      ).toBeNull();
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

    it("falls back to the legacy lcov.info layout when no pointer exists", async () => {
      const lcov = "SF:legacy/foo.mts\nDA:1,1\nend_of_record\n";
      const suiteDir = join(tmpDir, "legacy");
      mkdirSync(suiteDir);
      writeFileSync(join(suiteDir, "lcov.info"), lcov);
      expect((await store.get("legacy"))!.toString()).toBe(lcov);
    });

    it("rethrows non-ENOENT errors from the legacy fallback read", async () => {
      const suiteDir = join(tmpDir, "legacy");
      mkdirSync(suiteDir);
      mkdirSync(join(suiteDir, "lcov.info"));
      await expect(store.get("legacy")).rejects.toThrow();
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

    it("falls back to the previous unencoded branch pointer path", async () => {
      const lcov = Buffer.from("SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
      const shaDir = join(tmpDir, "backend", "sha", "abc");
      const branchDir = join(tmpDir, "backend", "branch", "main");
      mkdirSync(shaDir, { recursive: true });
      mkdirSync(branchDir, { recursive: true });
      writeFileSync(join(shaDir, "lcov.info"), lcov);
      writeFileSync(join(branchDir, "latest.json"), JSON.stringify({ sha: "abc" }));

      expect((await store.get("backend", { branch: "main" }))!.toString()).toBe(lcov.toString());
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
      const pointerPath = join(
        tmpDir,
        "backend",
        "branch",
        encodeBranchName("main"),
        "latest.json",
      );
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
        readFileSync(
          join(tmpDir, "backend", "branch", encodeBranchName("main"), "latest.json"),
          "utf8",
        ),
      );
      expect(pointer.timestamp).toBe("2026-01-01T00:00:00.000Z");
    });

    it("rejects invalid incoming timestamps", async () => {
      await expect(
        store.put("backend", Buffer.from(""), {
          sha: "abc",
          branch: "main",
          timestamp: "not-a-date",
        }),
      ).rejects.toThrow("invalid timestamp");
    });

    it("creates a default timestamp when none is provided", async () => {
      const before = new Date().toISOString();
      await store.put("backend", Buffer.from(""), { sha: "abc", branch: "main" });
      const after = new Date().toISOString();
      const pointer = JSON.parse(
        readFileSync(
          join(tmpDir, "backend", "branch", encodeBranchName("main"), "latest.json"),
          "utf8",
        ),
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

    it("accepts branch names with slashes by encoding the path component", async () => {
      await store.put("backend", Buffer.from("feature"), {
        sha: "abc",
        branch: "feature/foo",
      });
      expect((await store.get("backend", { branch: "feature/foo" }))!.toString()).toBe("feature");
      expect(
        readFileSync(
          join(tmpDir, "backend", "branch", encodeBranchName("feature/foo"), "latest.json"),
          "utf8",
        ),
      ).toContain("abc");
    });

    it("does not regress a branch pointer to an older timestamp", async () => {
      await store.put("backend", Buffer.from("new"), {
        sha: "new",
        branch: "main",
        timestamp: "2026-01-02T00:00:00.000Z",
      });
      await store.put("backend", Buffer.from("old"), {
        sha: "old",
        branch: "main",
        timestamp: "2026-01-01T00:00:00.000Z",
      });
      expect((await store.get("backend", { branch: "main" }))!.toString()).toBe("new");
      expect((await store.get("backend", { sha: "old" }))!.toString()).toBe("old");
    });

    it("rethrows non-ENOENT errors from pointer comparison", async () => {
      const branchDir = join(tmpDir, "backend", "branch", encodeBranchName("main"));
      mkdirSync(join(tmpDir, "backend", "sha", "abc"), { recursive: true });
      mkdirSync(branchDir, { recursive: true });
      mkdirSync(join(branchDir, "latest.json"));
      await expect(
        store.put("backend", Buffer.from(""), { sha: "abc", branch: "main" }),
      ).rejects.toThrow();
    });

    it("writes the legacy layout when metadata is omitted", async () => {
      await store.put("backend", Buffer.from("legacy"));
      expect(readFileSync(join(tmpDir, "backend", "lcov.info"), "utf8")).toBe("legacy");
      expect((await store.get("backend"))!.toString()).toBe("legacy");
    });

    it("rejects partial pointer metadata", async () => {
      await expect(store.put("backend", Buffer.from(""), { sha: "abc" } as never)).rejects.toThrow(
        "invalid branch",
      );
      await expect(
        store.put("backend", Buffer.from(""), { branch: "main" } as never),
      ).rejects.toThrow("invalid sha");
    });
  });

  describe("path traversal protection", () => {
    const invalid = ["", ".", "..", "a\\b"];
    for (const val of invalid) {
      it(`get() rejects suite=${JSON.stringify(val)}`, async () => {
        await expect(store.get(val)).rejects.toThrow("invalid suite");
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
      it(`put() rejects branch=${JSON.stringify(val)} before writing`, async () => {
        const suite = "backend-branch-check";
        await expect(
          store.put(suite, Buffer.from(""), { sha: "abc", branch: val }),
        ).rejects.toThrow("invalid branch");
        expect(() => readFileSync(join(tmpDir, suite, "sha", "abc", "lcov.info"))).toThrow();
      });
    }
  });
});

describe("assertSafePathComponent", () => {
  it("rejects non-string values at runtime (e.g. from JSON.parse)", () => {
    expect(() => assertSafePathComponent(123 as unknown as string, "sha")).toThrow("invalid sha");
    expect(() => assertSafePathComponent(null as unknown as string, "sha")).toThrow("invalid sha");
  });
});

describe("assertValidRepo", () => {
  it("accepts valid repository strings", () => {
    expect(assertValidRepo("owner/repo")).toBe("owner/repo");
    expect(assertValidRepo("owner/-repo")).toBe("owner/-repo");
    expect(assertValidRepo("owner/repo-name")).toBe("owner/repo-name");
  });

  it("trims repository strings before validation", () => {
    expect(assertValidRepo(" owner/repo ")).toBe("owner/repo");
  });

  it("rejects invalid repository strings", () => {
    expect(() => assertValidRepo("")).toThrow("Invalid repository format");
    expect(() => assertValidRepo("   ")).toThrow("Invalid repository format");
    expect(() => assertValidRepo(null as unknown as string)).toThrow("Invalid repository format");
    expect(() => assertValidRepo("-invalid/repo")).toThrow("Invalid repository format");
    expect(() => assertValidRepo("owner-without-slash-repo")).toThrow("Invalid repository format");
    expect(() => assertValidRepo("owner/.")).toThrow("Invalid repository format");
    expect(() => assertValidRepo("owner/..")).toThrow("Invalid repository format");
  });
});

describe("branch name encoding", () => {
  it("round-trips branch names with path separators", () => {
    const encoded = encodeBranchName("feature/foo");
    expect(encoded).not.toContain("/");
    expect(decodeBranchName(encoded)).toBe("feature/foo");
  });

  it("rejects empty and non-string branch names at runtime", () => {
    expect(() => encodeBranchName("")).toThrow("invalid branch");
    expect(() => encodeBranchName(null as unknown as string)).toThrow("invalid branch");
  });

  it("throws on path traversal attempts", () => {
    expect(() => encodeBranchName("../../etc")).toThrow("invalid branch");
    expect(() => encodeBranchName("..\\..\\etc")).toThrow("invalid branch");
  });
});

describe("isNewerTimestamp", () => {
  it("returns false when there is no current timestamp", () => {
    expect(isNewerTimestamp(undefined, "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("rejects an invalid incoming timestamp", () => {
    expect(() => isNewerTimestamp("2026-01-01T00:00:00.000Z", "not-a-date")).toThrow(
      "invalid timestamp",
    );
  });
});

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadBaselineSnapshot } from "./baseline-snapshot-loader.mts";
import {
  baselineSnapshotPayloadObjectName,
  hashBaselineSnapshotPayload,
} from "./baseline-snapshot.mts";
import { FileSystemSuiteStore } from "./suite-store.mts";

describe("loadBaselineSnapshot", () => {
  let root: string;
  let store: FileSystemSuiteStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "baseline-snapshot-loader-"));
    store = new FileSystemSuiteStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("records absent suites so they cannot appear later under the same key", async () => {
    const first = await loadBaselineSnapshot(store, "key", "main", ["optional"]);
    expect(first.snapshot.suites).toEqual([{ suite: "optional", sha: null, payloadHash: null }]);
    expect(first.suites).toEqual([]);

    await store.put("optional", Buffer.from("later"), { sha: "later", branch: "main" });
    const rerun = await loadBaselineSnapshot(store, "key", "main", ["optional"]);
    expect(rerun.created).toBe(false);
    expect(rerun.snapshot.suites).toEqual([{ suite: "optional", sha: null, payloadHash: null }]);
    expect(rerun.suites).toEqual([]);
  });

  it("rejects branch and active-suite manifest reuse mismatches", async () => {
    await loadBaselineSnapshot(store, "key", "main", ["backend"]);
    await expect(loadBaselineSnapshot(store, "key", "release", ["backend"])).rejects.toThrow(
      "branch mismatch",
    );
    await expect(loadBaselineSnapshot(store, "key", "main", ["web"])).rejects.toThrow(
      "active-suite manifest",
    );
  });

  it("keeps the baseline immutable when the same sha payload is overwritten", async () => {
    await store.put("backend", Buffer.from("baseline"), { sha: "abc", branch: "main" });
    const first = await loadBaselineSnapshot(store, "key", "main", ["backend"]);
    await store.put("backend", Buffer.from("replacement"), { sha: "abc", branch: "main" });

    const rerun = await loadBaselineSnapshot(store, "key", "main", ["backend"]);
    expect(first.suites[0]?.buffer.toString()).toBe("baseline");
    expect(rerun.suites[0]?.buffer.toString()).toBe("baseline");
  });

  it("fails when an immutable payload referenced by a snapshot disappears", async () => {
    const payload = Buffer.from("baseline");
    await store.put("backend", payload, { sha: "abc", branch: "main" });
    await loadBaselineSnapshot(store, "key", "main", ["backend"]);
    rmSync(join(root, baselineSnapshotPayloadObjectName(hashBaselineSnapshotPayload(payload))));
    await expect(loadBaselineSnapshot(store, "key", "main", ["backend"])).rejects.toThrow(
      "references missing immutable payload",
    );
  });

  it("creates a filesystem snapshot when the store root does not exist", async () => {
    const missingRoot = join(root, "nested", "store");
    const missingStore = new FileSystemSuiteStore(missingRoot);
    const loaded = await loadBaselineSnapshot(missingStore, "key", "main", []);
    expect(loaded.created).toBe(true);
    expect(() => mkdirSync(missingRoot)).toThrow();
  });
});

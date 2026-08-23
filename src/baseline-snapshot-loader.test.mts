import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeBaselineSnapshotLcov,
  formatBaselineSnapshotDiagnostic,
  loadBaselineSnapshot,
} from "./baseline-snapshot-loader.mts";
import {
  baselineSnapshotObjectName,
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
    expect(formatBaselineSnapshotDiagnostic(first)).toContain("optional=absent");

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

  it("rejects a manifest whose embedded key does not match its storage key", async () => {
    await loadBaselineSnapshot(store, "key", "main", []);
    const path = join(root, baselineSnapshotObjectName("key"));
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as { key: string };
    snapshot.key = "different";
    writeFileSync(path, JSON.stringify(snapshot));
    await expect(loadBaselineSnapshot(store, "key", "main", [])).rejects.toThrow("storage key");
  });

  it("keeps the baseline immutable when the same sha payload is overwritten", async () => {
    await store.put("backend", Buffer.from("baseline"), { sha: "abc", branch: "main" });
    const first = await loadBaselineSnapshot(store, "key", "main", ["backend"]);
    await store.put("backend", Buffer.from("replacement"), { sha: "abc", branch: "main" });

    const rerun = await loadBaselineSnapshot(store, "key", "main", ["backend"]);
    expect(first.suites[0]?.buffer.toString()).toBe("baseline");
    expect(rerun.suites[0]?.buffer.toString()).toBe("baseline");
  });

  it("fails when the branch pointer references a missing source payload", async () => {
    await store.put("backend", Buffer.from("baseline"), { sha: "abc", branch: "main" });
    rmSync(join(root, "backend", "sha", "abc", "lcov.info"));
    await expect(loadBaselineSnapshot(store, "key", "main", ["backend"])).rejects.toThrow(
      "baseline branch references missing payload",
    );
  });

  it("fails when an immutable payload does not match its content hash", async () => {
    const payload = Buffer.from("baseline");
    await store.put("backend", payload, { sha: "abc", branch: "main" });
    await loadBaselineSnapshot(store, "key", "main", ["backend"]);
    writeFileSync(
      join(root, baselineSnapshotPayloadObjectName(hashBaselineSnapshotPayload(payload))),
      "corrupt",
    );
    await expect(loadBaselineSnapshot(store, "key", "main", ["backend"])).rejects.toThrow(
      "payload hash mismatch",
    );
  });

  it("lists and sorts suites when no active-suite manifest is supplied", async () => {
    await store.put("web", Buffer.from("web"), { sha: "web", branch: "main" });
    await store.put("backend", Buffer.from("backend"), { sha: "backend", branch: "main" });
    const loaded = await loadBaselineSnapshot(store, "key", "main");
    expect(loaded.snapshot.suites.map(({ suite }) => suite)).toEqual(["backend", "web"]);
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

describe("decodeBaselineSnapshotLcov", () => {
  it("accepts a complete LCOV record", () => {
    expect(
      decodeBaselineSnapshotLcov(Buffer.from("TN:\nSF:backend/foo.mts\nDA:1,1\nend_of_record\n")),
    ).toContain("SF:backend/foo.mts");
  });

  it.each([
    Buffer.from([0xff]),
    Buffer.from("arbitrary text"),
    Buffer.from("SF:\nend_of_record\n"),
    Buffer.from("DA:1,1\n"),
    Buffer.from("SF:file\nDA:not-valid\nend_of_record\n"),
    Buffer.from("SF:file\n"),
    Buffer.from("end_of_record\n"),
  ])("rejects invalid UTF-8 and malformed LCOV", (payload) => {
    expect(() => decodeBaselineSnapshotLcov(payload)).toThrow(/UTF-8|malformed/);
  });
});

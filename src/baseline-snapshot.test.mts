import { describe, expect, it } from "vitest";
import {
  baselineSnapshotObjectName,
  createBaselineSnapshot,
  parseBaselineSnapshot,
  parseBaselineSnapshotBuffer,
  serializeBaselineSnapshot,
} from "./baseline-snapshot.mts";

describe("baseline snapshots", () => {
  it("sorts suites and round-trips the versioned format", () => {
    const snapshot = createBaselineSnapshot("owner/repo:pr-39:head", "main", [
      { suite: "web", sha: null },
      { suite: "backend", sha: "abc" },
    ]);
    expect(snapshot.suites).toEqual([
      { suite: "backend", sha: "abc" },
      { suite: "web", sha: null },
    ]);
    expect(parseBaselineSnapshotBuffer(serializeBaselineSnapshot(snapshot))).toEqual(snapshot);
  });

  it("hashes keys into safe, stable object names", () => {
    const name = baselineSnapshotObjectName("owner/repo:pr-39:head");
    expect(name).toMatch(/^\.coverage-check-baseline-snapshot-v1-[a-f0-9]{64}\.json$/);
    expect(baselineSnapshotObjectName("owner/repo:pr-39:head")).toBe(name);
  });

  it("rejects empty, oversized, duplicate, and unsafe data", () => {
    expect(() => baselineSnapshotObjectName("")).toThrow("between 1 and 512");
    expect(() => baselineSnapshotObjectName("x".repeat(513))).toThrow("between 1 and 512");
    expect(() =>
      parseBaselineSnapshot({
        version: 1,
        key: "key",
        branch: "main",
        createdAt: new Date().toISOString(),
        suites: [
          { suite: "backend", sha: "one" },
          { suite: "backend", sha: "two" },
        ],
      }),
    ).toThrow("duplicate");
    expect(() =>
      parseBaselineSnapshot({
        version: 1,
        key: "key",
        branch: "main",
        createdAt: new Date().toISOString(),
        suites: [{ suite: "../backend", sha: "one" }],
      }),
    ).toThrow("invalid baseline snapshot suite");
    expect(() => parseBaselineSnapshotBuffer(Buffer.from("not json"))).toThrow(
      "invalid baseline snapshot",
    );
  });
});

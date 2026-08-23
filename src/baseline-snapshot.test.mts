import { describe, expect, it } from "vitest";
import {
  baselineSnapshotObjectName,
  baselineSnapshotPayloadObjectName,
  createBaselineSnapshot,
  hashBaselineSnapshotPayload,
  parseBaselineSnapshot,
  parseBaselineSnapshotBuffer,
  serializeBaselineSnapshot,
} from "./baseline-snapshot.mts";

describe("baseline snapshots", () => {
  const payloadHash = hashBaselineSnapshotPayload(Buffer.from("baseline"));

  it("sorts suites and round-trips the versioned format", () => {
    const snapshot = createBaselineSnapshot("owner/repo:pr-39:head", "main", [
      { suite: "web", sha: null, payloadHash: null },
      { suite: "backend", sha: "abc", payloadHash },
    ]);
    expect(snapshot.suites).toEqual([
      { suite: "backend", sha: "abc", payloadHash },
      { suite: "web", sha: null, payloadHash: null },
    ]);
    expect(parseBaselineSnapshotBuffer(serializeBaselineSnapshot(snapshot))).toEqual(snapshot);
  });

  it("hashes keys into safe, stable object names", () => {
    const name = baselineSnapshotObjectName("owner/repo:pr-39:head");
    expect(name).toMatch(/^\.coverage-check-baseline-snapshot-v1-[a-f0-9]{64}\.json$/);
    expect(baselineSnapshotObjectName("owner/repo:pr-39:head")).toBe(name);
    expect(baselineSnapshotPayloadObjectName(payloadHash)).toBe(
      `.coverage-check-baseline-payload-v1-${payloadHash}.lcov`,
    );
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
          { suite: "backend", sha: "one", payloadHash },
          { suite: "backend", sha: "two", payloadHash },
        ],
      }),
    ).toThrow("duplicate");
    expect(() =>
      parseBaselineSnapshot({
        version: 1,
        key: "key",
        branch: "main",
        createdAt: new Date().toISOString(),
        suites: [{ suite: "../backend", sha: "one", payloadHash }],
      }),
    ).toThrow("invalid baseline snapshot suite");
    expect(() => baselineSnapshotPayloadObjectName("not-a-hash")).toThrow("payload hash");
    expect(() =>
      parseBaselineSnapshot({
        version: 1,
        key: "key",
        branch: "main",
        createdAt: new Date().toISOString(),
        suites: [{ suite: "backend", sha: "one", payloadHash: null }],
      }),
    ).toThrow("both be present or absent");
    expect(() => parseBaselineSnapshotBuffer(Buffer.from("not json"))).toThrow(
      "invalid baseline snapshot",
    );
  });
});

import { createHash } from "node:crypto";

export const BASELINE_SNAPSHOT_OBJECT_PREFIX = ".coverage-check-baseline-snapshot-v1-";
export const BASELINE_SNAPSHOT_PAYLOAD_PREFIX = ".coverage-check-baseline-payload-v1-";

export type BaselineSnapshotEntry = {
  suite: string;
  sha: string | null;
  payloadHash: string | null;
};

export type BaselineSnapshot = {
  version: 1;
  key: string;
  branch: string;
  createdAt: string;
  suites: BaselineSnapshotEntry[];
};

export type ResolvedSuiteVersion = { kind: "sha"; sha: string } | { kind: "legacy" };

export type BaselineSnapshotWriteResult = {
  snapshot: BaselineSnapshot;
  created: boolean;
};

export function assertValidBaselineSnapshotKey(key: string): void {
  if (typeof key !== "string" || key.length === 0 || Buffer.byteLength(key, "utf8") > 512) {
    throw new Error("baseline snapshot key must be between 1 and 512 UTF-8 bytes");
  }
}

export function baselineSnapshotObjectName(key: string): string {
  assertValidBaselineSnapshotKey(key);
  return `${BASELINE_SNAPSHOT_OBJECT_PREFIX}${createHash("sha256").update(key, "utf8").digest("hex")}.json`;
}

export function hashBaselineSnapshotPayload(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function baselineSnapshotPayloadObjectName(payloadHash: string): string {
  assertValidPayloadHash(payloadHash);
  return `${BASELINE_SNAPSHOT_PAYLOAD_PREFIX}${payloadHash}.lcov`;
}

export function createBaselineSnapshot(
  key: string,
  branch: string,
  suites: BaselineSnapshotEntry[],
): BaselineSnapshot {
  return parseBaselineSnapshot({
    version: 1,
    key,
    branch,
    createdAt: new Date().toISOString(),
    suites,
  });
}

export function parseBaselineSnapshot(value: unknown): BaselineSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("baseline snapshot must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (candidate["version"] !== 1) throw new Error("unsupported baseline snapshot version");

  const key = candidate["key"];
  if (typeof key !== "string") throw new Error("invalid baseline snapshot key");
  assertValidBaselineSnapshotKey(key);

  const branch = candidate["branch"];
  if (typeof branch !== "string" || branch.length === 0) {
    throw new Error("invalid baseline snapshot branch");
  }
  const createdAt = candidate["createdAt"];
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error("invalid baseline snapshot timestamp");
  }
  const rawSuites = candidate["suites"];
  if (!Array.isArray(rawSuites)) throw new Error("invalid baseline snapshot suites");

  const seen = new Set<string>();
  const suites = rawSuites.map((raw): BaselineSnapshotEntry => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("invalid baseline snapshot suite entry");
    }
    const entry = raw as Record<string, unknown>;
    const suite = entry["suite"];
    const sha = entry["sha"];
    const payloadHash = entry["payloadHash"];
    assertSafeComponent(suite, "suite");
    if (sha !== null) assertSafeComponent(sha, "sha");
    if (payloadHash !== null) assertValidPayloadHash(payloadHash);
    if ((sha === null) !== (payloadHash === null)) {
      throw new Error(
        "baseline snapshot suite sha and payload hash must both be present or absent",
      );
    }
    if (seen.has(suite)) throw new Error(`duplicate baseline snapshot suite: ${suite}`);
    seen.add(suite);
    return { suite, sha, payloadHash };
  });
  suites.sort((a, b) => a.suite.localeCompare(b.suite));
  return { version: 1, key, branch, createdAt, suites };
}

function assertValidPayloadHash(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("invalid baseline snapshot payload hash");
  }
}

export function serializeBaselineSnapshot(snapshot: BaselineSnapshot): Buffer {
  return Buffer.from(JSON.stringify(parseBaselineSnapshot(snapshot), null, 2), "utf8");
}

export function parseBaselineSnapshotBuffer(buffer: Buffer): BaselineSnapshot {
  try {
    return parseBaselineSnapshot(JSON.parse(buffer.toString("utf8")));
  } catch (err) {
    throw new Error(`invalid baseline snapshot: ${String(err)}`);
  }
}

function assertSafeComponent(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error(`invalid baseline snapshot ${label}`);
  }
}

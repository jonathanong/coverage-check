import { createBaselineSnapshot, hashBaselineSnapshotPayload } from "./baseline-snapshot.mts";
import { isSnapshotSuiteStore } from "./suite-store.mts";
import type { BaselineSnapshot, BaselineSnapshotEntry } from "./baseline-snapshot.mts";
import type { SuiteStore } from "./suite-store.mts";

export type LoadedBaselineSnapshot = {
  snapshot: BaselineSnapshot;
  created: boolean;
  suites: { suite: string; buffer: Buffer }[];
};

export async function loadBaselineSnapshot(
  store: SuiteStore,
  key: string,
  branch: string,
  activeSuites?: string[],
): Promise<LoadedBaselineSnapshot> {
  if (!isSnapshotSuiteStore(store)) {
    throw new Error("the configured SuiteStore does not support baseline snapshots");
  }

  let snapshot = await store.readBaselineSnapshot(key);
  let created = false;
  if (snapshot === null) {
    const suiteNames =
      activeSuites === undefined ? sortedUnique(await store.list()) : sortedUnique(activeSuites);
    const entries = await Promise.all(
      suiteNames.map(async (suite): Promise<BaselineSnapshotEntry> => {
        const resolved = await store.resolveVersion(suite, branch);
        if (resolved?.kind === "legacy") {
          throw new Error(
            `suite ${JSON.stringify(suite)} uses the mutable legacy layout; store it with --sha and --branch before pinning`,
          );
        }
        if (resolved === null) return { suite, sha: null, payloadHash: null };
        const buffer = await store.get(suite, { sha: resolved.sha });
        if (buffer === null) {
          throw new Error(
            `baseline branch references missing payload for suite ${JSON.stringify(suite)} at sha ${JSON.stringify(resolved.sha)}`,
          );
        }
        const payloadHash = hashBaselineSnapshotPayload(buffer);
        await store.putBaselineSnapshotPayloadIfAbsent(payloadHash, buffer);
        return { suite, sha: resolved.sha, payloadHash };
      }),
    );
    const candidate = createBaselineSnapshot(key, branch, entries);
    const written = await store.putBaselineSnapshotIfAbsent(key, candidate);
    snapshot = written.snapshot;
    created = written.created;
  }

  validateSnapshotRequest(snapshot, key, branch, activeSuites);
  const suites = (
    await Promise.all(
      snapshot.suites.map(async ({ suite, sha, payloadHash }) => {
        if (sha === null || payloadHash === null) return null;
        const buffer = await store.readBaselineSnapshotPayload(payloadHash);
        if (buffer === null) {
          throw new Error(
            `baseline snapshot references missing immutable payload for suite ${JSON.stringify(suite)} at sha ${JSON.stringify(sha)}`,
          );
        }
        if (hashBaselineSnapshotPayload(buffer) !== payloadHash) {
          throw new Error(
            `baseline snapshot payload hash mismatch for suite ${JSON.stringify(suite)} at sha ${JSON.stringify(sha)}`,
          );
        }
        return { suite, buffer };
      }),
    )
  ).filter((suite): suite is { suite: string; buffer: Buffer } => suite !== null);
  return { snapshot, created, suites };
}

export function formatBaselineSnapshotDiagnostic(loaded: LoadedBaselineSnapshot): string {
  const entries = loaded.snapshot.suites
    .map(({ suite, sha }) => `${suite}=${sha ?? "absent"}`)
    .join(", ");
  return `coverage-check: baseline snapshot ${loaded.created ? "created" : "reused"} key=${JSON.stringify(loaded.snapshot.key)} branch=${JSON.stringify(loaded.snapshot.branch)} suites=[${entries}]`;
}

function validateSnapshotRequest(
  snapshot: BaselineSnapshot,
  key: string,
  branch: string,
  activeSuites: string[] | undefined,
): void {
  if (snapshot.key !== key) throw new Error("baseline snapshot key does not match its storage key");
  if (snapshot.branch !== branch) {
    throw new Error(
      `baseline snapshot branch mismatch: stored ${JSON.stringify(snapshot.branch)}, requested ${JSON.stringify(branch)}`,
    );
  }
  if (activeSuites === undefined) return;
  const expected = sortedUnique(activeSuites);
  const actual = snapshot.suites.map(({ suite }) => suite);
  if (
    expected.length !== actual.length ||
    expected.some((suite, index) => suite !== actual[index])
  ) {
    throw new Error("baseline snapshot active-suite manifest does not match this check");
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

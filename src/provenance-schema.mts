import {
  SOURCE_ROOT_ALGORITHM,
  type AnyCoverageManifest,
  type CoverageManifest,
  type PatchCoverageManifest,
} from "./provenance-types.mts";
import { isCoverageRunId } from "./provenance-integrity.mts";

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  const expected = new Set(keys);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

export function parseCoverageManifest(raw: unknown): CoverageManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Coverage manifest must be an object");
  }
  const manifest = raw as Record<string, unknown>;
  const exactKeys = [
    "collector",
    "lcov",
    "projects",
    "repository",
    "revision",
    "run",
    "sourceRoot",
    "suite",
    "version",
  ];
  if (!exactObject(manifest, exactKeys) || manifest.version !== 1) {
    throw new Error("Coverage manifest has an unsupported schema");
  }
  const collector = manifest.collector;
  const lcov = manifest.lcov;
  const sourceRoot = manifest.sourceRoot;
  const run = manifest.run;
  const digestPattern = /^[0-9a-f]{64}$/;
  if (
    typeof manifest.repository !== "string" ||
    !manifest.repository ||
    typeof manifest.suite !== "string" ||
    !manifest.suite ||
    !Array.isArray(manifest.projects) ||
    manifest.projects.length === 0 ||
    manifest.projects.some((project) => typeof project !== "string" || !project) ||
    typeof manifest.revision !== "string" ||
    !/^[0-9a-f]{40}$/.test(manifest.revision) ||
    !exactObject(collector, ["name", "settings", "version"]) ||
    typeof collector.name !== "string" ||
    !collector.name ||
    typeof collector.version !== "string" ||
    !collector.version ||
    !collector.settings ||
    typeof collector.settings !== "object" ||
    Array.isArray(collector.settings) ||
    !exactObject(lcov, ["bytes", "sha256"]) ||
    !positiveInteger(lcov.bytes) ||
    typeof lcov.sha256 !== "string" ||
    !digestPattern.test(lcov.sha256) ||
    !exactObject(sourceRoot, ["algorithm", "files", "sha256"]) ||
    sourceRoot.algorithm !== SOURCE_ROOT_ALGORITHM ||
    !positiveInteger(sourceRoot.files) ||
    typeof sourceRoot.sha256 !== "string" ||
    !digestPattern.test(sourceRoot.sha256) ||
    !(
      run === null ||
      (exactObject(run, ["attempt", "id"]) &&
        isCoverageRunId(run.id) &&
        positiveInteger(run.attempt))
    )
  ) {
    throw new Error("Coverage manifest has an unsupported schema");
  }
  return manifest as CoverageManifest;
}

export function parsePatchCoverageManifest(raw: unknown): PatchCoverageManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Patch coverage manifest must be an object");
  }
  const manifest = raw as Record<string, unknown>;
  const keys = [
    "collector",
    "kind",
    "lcov",
    "patch",
    "producer",
    "projects",
    "repository",
    "revision",
    "run",
    "sourceRoot",
    "suite",
    "version",
  ];
  const digestPattern = /^[0-9a-f]{64}$/;
  const collector = manifest.collector;
  const lcov = manifest.lcov;
  const sourceRoot = manifest.sourceRoot;
  const patch = manifest.patch;
  const producer = manifest.producer;
  const run = manifest.run;
  if (
    !exactObject(manifest, keys) ||
    manifest.version !== 2 ||
    manifest.kind !== "patch-lcov" ||
    typeof manifest.repository !== "string" ||
    !manifest.repository ||
    typeof manifest.suite !== "string" ||
    !manifest.suite ||
    !Array.isArray(manifest.projects) ||
    manifest.projects.length === 0 ||
    manifest.projects.some((value) => typeof value !== "string" || !value) ||
    typeof manifest.revision !== "string" ||
    !/^[0-9a-f]{40}$/.test(manifest.revision) ||
    !exactObject(run, ["attempt", "id"]) ||
    !isCoverageRunId(run.id) ||
    !positiveInteger(run.attempt) ||
    !exactObject(collector, ["name", "settings", "version"]) ||
    typeof collector.name !== "string" ||
    !collector.name ||
    typeof collector.version !== "string" ||
    !collector.version ||
    !collector.settings ||
    typeof collector.settings !== "object" ||
    Array.isArray(collector.settings) ||
    !exactObject(lcov, ["bytes", "sha256"]) ||
    typeof lcov.bytes !== "number" ||
    !Number.isSafeInteger(lcov.bytes) ||
    lcov.bytes < 0 ||
    typeof lcov.sha256 !== "string" ||
    !digestPattern.test(lcov.sha256) ||
    !exactObject(sourceRoot, ["algorithm", "files", "sha256"]) ||
    sourceRoot.algorithm !== SOURCE_ROOT_ALGORITHM ||
    typeof sourceRoot.files !== "number" ||
    !Number.isSafeInteger(sourceRoot.files) ||
    sourceRoot.files < 0 ||
    typeof sourceRoot.sha256 !== "string" ||
    !digestPattern.test(sourceRoot.sha256) ||
    !exactObject(patch, ["algorithm", "base", "changedLinesSha256", "head"]) ||
    patch.algorithm !== "git-merge-base-diff-v1" ||
    typeof patch.base !== "string" ||
    !/^[0-9a-f]{40}$/.test(patch.base) ||
    typeof patch.head !== "string" ||
    !/^[0-9a-f]{40}$/.test(patch.head) ||
    typeof patch.changedLinesSha256 !== "string" ||
    !digestPattern.test(patch.changedLinesSha256) ||
    !exactObject(producer, ["group", "index", "total"]) ||
    typeof producer.group !== "string" ||
    !/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(producer.group) ||
    !positiveInteger(producer.index) ||
    !positiveInteger(producer.total) ||
    producer.index > producer.total
  )
    throw new Error("Patch coverage manifest has an unsupported schema");
  return manifest as PatchCoverageManifest;
}

export function parseAnyCoverageManifest(raw: unknown): AnyCoverageManifest {
  return (raw as { version?: unknown })?.version === 2
    ? parsePatchCoverageManifest(raw)
    : parseCoverageManifest(raw);
}

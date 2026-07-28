import { SOURCE_ROOT_ALGORITHM, type CoverageManifest } from "./provenance-types.mts";
import { isCoverageRunId } from "./provenance-integrity.mts";

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).toSorted().join("\0") === keys.toSorted().join("\0"),
  );
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
  if (
    Object.keys(manifest).toSorted().join("\0") !== exactKeys.toSorted().join("\0") ||
    manifest.version !== 1
  ) {
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

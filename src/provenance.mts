import { readFileSync } from "node:fs";
import { replaceCoveragePairFiles } from "./provenance-artifact-output.mts";
import {
  canonicalize,
  digest,
  isCoverageRunId,
  normalizeSources,
  sourceRootDigest,
  validatePathComponent,
  validateRevision,
} from "./provenance-integrity.mts";
import { parseCoverageManifest } from "./provenance-schema.mts";
import {
  SOURCE_ROOT_ALGORITHM,
  type CoverageArtifactDescriptor,
  type CoverageManifest,
  type StampCoverageManifestOptions,
  type ValidateCoverageManifestOptions,
} from "./provenance-types.mts";

export { COVERAGE_MANIFEST_FILENAME, SOURCE_ROOT_ALGORITHM } from "./provenance-types.mts";
export {
  parseCoverageManifest,
  type CoverageArtifactDescriptor,
  type CoverageManifest,
  type StampCoverageManifestOptions,
  type ValidateCoverageManifestOptions,
};

export function serializeCoverageManifest(manifest: CoverageManifest): string {
  return `${JSON.stringify(canonicalize(manifest), null, 2)}\n`;
}

function validateDescriptor(
  descriptor: StampCoverageManifestOptions["descriptor"],
  collectorVersion?: string,
): void {
  if (!descriptor || typeof descriptor !== "object") {
    throw new TypeError("Coverage descriptor must be an object");
  }
  if (typeof descriptor.suite !== "string") {
    throw new TypeError("Coverage suite must be a string");
  }
  validatePathComponent(descriptor.suite, "Coverage suite");
  if (
    !Array.isArray(descriptor.projects) ||
    descriptor.projects.length === 0 ||
    descriptor.projects.some((project) => typeof project !== "string" || !project) ||
    !descriptor.collector ||
    typeof descriptor.collector !== "object" ||
    typeof descriptor.collector.name !== "string" ||
    !descriptor.collector.name ||
    !descriptor.collector.settings ||
    typeof descriptor.collector.settings !== "object" ||
    Array.isArray(descriptor.collector.settings) ||
    (collectorVersion !== undefined && (typeof collectorVersion !== "string" || !collectorVersion))
  ) {
    throw new Error("Coverage descriptor and collector version must be complete");
  }
}

export function stampCoverageManifest(options: StampCoverageManifestOptions): CoverageManifest {
  validateRevision(options.revision);
  validateDescriptor(options.descriptor, options.collectorVersion);
  if (typeof options.repository !== "string" || !options.repository) {
    throw new Error("Coverage repository is required");
  }
  if (
    options.run &&
    (!isCoverageRunId(options.run.id) ||
      !Number.isSafeInteger(options.run.attempt) ||
      options.run.attempt < 1)
  ) {
    throw new Error("Coverage run id must be non-empty and attempt must be a positive integer");
  }

  const { normalizedLcov, sources } = normalizeSources(
    options.root,
    readFileSync(options.lcovPath, "utf8"),
  );
  const lcovBytes = Buffer.from(normalizedLcov);
  const manifest: CoverageManifest = {
    version: 1,
    repository: options.repository,
    suite: options.descriptor.suite,
    projects: options.descriptor.projects,
    revision: options.revision,
    run: options.run,
    collector: {
      name: options.descriptor.collector.name,
      version: options.collectorVersion,
      settings: options.descriptor.collector.settings,
    },
    lcov: {
      bytes: lcovBytes.byteLength,
      sha256: digest(lcovBytes),
    },
    sourceRoot: {
      algorithm: SOURCE_ROOT_ALGORITHM,
      files: sources.length,
      sha256: sourceRootDigest(sources),
    },
  };
  const manifestBytes = serializeCoverageManifest(manifest);
  const parsedManifest = parseCoverageManifest(JSON.parse(manifestBytes) as unknown);
  replaceCoveragePairFiles(
    options.lcovPath,
    options.manifestPath,
    Buffer.from(normalizedLcov),
    Buffer.from(manifestBytes),
  );
  return parsedManifest;
}

export function validateCoverageManifest(
  options: ValidateCoverageManifestOptions,
): CoverageManifest {
  return validateCoverageManifestBytes(
    options,
    readFileSync(options.lcovPath),
    readFileSync(options.manifestPath),
  );
}

export function validateCoverageManifestBytes(
  options: ValidateCoverageManifestOptions,
  rawLcov: Buffer,
  manifestBytes: Buffer,
): CoverageManifest {
  validateDescriptor(options.descriptor, options.expectedCollectorVersion);
  validateRevision(options.revision);
  if (
    options.expectedRun &&
    (!isCoverageRunId(options.expectedRun.id) ||
      !Number.isSafeInteger(options.expectedRun.currentAttempt) ||
      options.expectedRun.currentAttempt < 1)
  ) {
    throw new Error("Expected coverage run id and attempt must be valid");
  }
  const manifest = parseCoverageManifest(JSON.parse(manifestBytes.toString("utf8")) as unknown);
  if (
    manifest.repository !== options.repository ||
    manifest.revision !== options.revision ||
    manifest.suite !== options.descriptor.suite ||
    JSON.stringify(manifest.projects) !== JSON.stringify(options.descriptor.projects) ||
    manifest.collector.name !== options.descriptor.collector.name ||
    (options.expectedCollectorVersion !== undefined &&
      manifest.collector.version !== options.expectedCollectorVersion) ||
    JSON.stringify(canonicalize(manifest.collector.settings)) !==
      JSON.stringify(canonicalize(options.descriptor.collector.settings))
  ) {
    throw new Error("Coverage manifest identity does not match the expected suite");
  }
  if (options.expectedRun === null) {
    if (manifest.run !== null) throw new Error("Coverage manifest is not a local run");
  } else {
    const runMatches =
      manifest.run === null
        ? false
        : manifest.run.id === options.expectedRun.id &&
          manifest.run.attempt <= options.expectedRun.currentAttempt;
    if (!runMatches) {
      throw new Error("Coverage manifest run does not match the current CI run");
    }
  }

  const { normalizedLcov, sources } = normalizeSources(options.root, rawLcov.toString("utf8"));
  if (
    normalizedLcov !== rawLcov.toString("utf8") ||
    manifest.lcov.bytes !== rawLcov.byteLength ||
    manifest.lcov.sha256 !== digest(rawLcov)
  ) {
    throw new Error("Coverage manifest LCOV integrity check failed");
  }
  if (
    manifest.sourceRoot.algorithm !== SOURCE_ROOT_ALGORITHM ||
    manifest.sourceRoot.files !== sources.length ||
    manifest.sourceRoot.sha256 !== sourceRootDigest(sources)
  ) {
    throw new Error("Coverage manifest source-root integrity check failed");
  }
  return manifest;
}

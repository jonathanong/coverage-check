export const COVERAGE_MANIFEST_FILENAME = "coverage-manifest.json";
export const SOURCE_ROOT_ALGORITHM = "sha256-coverage-check-lcov-source-files-v1";

export type CoverageRun = {
  id: string;
  attempt: number;
};

export type ExpectedCoverageRun = {
  id: string;
  currentAttempt: number;
};

export type CoverageCollectorName = "vitest-v8" | "llvm-cov" | "coverlet";

export type CoverageCollectorProfile = {
  readonly name: CoverageCollectorName;
  readonly settings: Readonly<Record<string, unknown>>;
};

export type CoverageSuiteDescriptor = {
  readonly suite: string;
  readonly projects: readonly string[];
  readonly collector: CoverageCollectorProfile;
};

export type CoverageArtifactDescriptor = {
  suite: string;
  projects: readonly string[];
  collector: {
    name: string;
    settings: Readonly<Record<string, unknown>>;
  };
};

export type CoverageManifest = {
  version: 1;
  repository: string;
  suite: string;
  projects: readonly string[];
  revision: string;
  run: CoverageRun | null;
  collector: {
    name: string;
    version: string;
    settings: Readonly<Record<string, unknown>>;
  };
  lcov: {
    bytes: number;
    sha256: string;
  };
  sourceRoot: {
    algorithm: typeof SOURCE_ROOT_ALGORITHM;
    files: number;
    sha256: string;
  };
};

/** A patch-only LCOV projection. Unlike v1, its payload and source set may be empty. */
export type PatchCoverageManifest = {
  version: 2;
  kind: "patch-lcov";
  repository: string;
  suite: string;
  projects: readonly string[];
  revision: string;
  run: CoverageRun;
  collector: {
    name: string;
    version: string;
    settings: Readonly<Record<string, unknown>>;
  };
  lcov: { bytes: number; sha256: string };
  sourceRoot: { algorithm: typeof SOURCE_ROOT_ALGORITHM; files: number; sha256: string };
  patch: {
    algorithm: "git-merge-base-diff-v1";
    base: string;
    head: string;
    changedLinesSha256: string;
  };
  producer: { index: number; total: number };
};

export type AnyCoverageManifest = CoverageManifest | PatchCoverageManifest;

type ManifestPaths = {
  root: string;
  lcovPath: string;
  manifestPath: string;
};

export type StampCoverageManifestOptions = ManifestPaths & {
  descriptor: CoverageArtifactDescriptor;
  repository: string;
  revision: string;
  run: CoverageRun | null;
  collectorVersion: string;
};

export type ValidateCoverageManifestOptions = ManifestPaths & {
  descriptor: CoverageArtifactDescriptor;
  repository: string;
  revision: string;
  expectedRun: ExpectedCoverageRun | null;
  expectedCollectorVersion?: string;
};

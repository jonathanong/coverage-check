export { checkCoverage, evaluateCheck, runCheck } from "./commands/check.mts";
export { runStorePut } from "./commands/store-put.mts";
export { runMerge } from "./commands/merge.mts";
export {
  missingCoverageArtifacts,
  normalizeCoverageArtifacts,
  prepareCoverageArtifacts,
  runPrepareArtifacts,
} from "./commands/prepare-artifacts.mts";
export { FileSystemSuiteStore } from "./suite-store.mts";
export { S3SuiteStore } from "./s3-suite-store.mts";
export {
  baselineSnapshotObjectName,
  baselineSnapshotPayloadObjectName,
  hashBaselineSnapshotPayload,
  parseBaselineSnapshot,
  parseBaselineSnapshotBuffer,
  serializeBaselineSnapshot,
} from "./baseline-snapshot.mts";
export { parseDiffWithContent, getChangedLineContent } from "./diff-parser-content.mts";
export { collapseRanges } from "./report.mts";
export { parseLcovFull, mergeLcovFull, toLcovFull } from "./lcov-records.mts";
export { collectLcovFiles } from "./load-artifacts.mts";
export { loadCoverageConfig, loadRules, zeroThresholdGlobs } from "./rules.mts";
export {
  coverageDisposition,
  executableLineNumbers,
  findMissingCoverage,
  normalizeCoveragePath,
} from "./scope.mts";
export {
  COVERAGE_MANIFEST_FILENAME,
  SOURCE_ROOT_ALGORITHM,
  parseCoverageManifest,
  serializeCoverageManifest,
  stampCoverageManifest,
  validateCoverageManifest,
} from "./provenance.mts";
export { prepareProvenanceArtifacts } from "./provenance-artifacts.mts";
export {
  expectedCollectorVersion,
  transportFromSources,
  validateSwiftCollectorVersions,
} from "./provenance-policy.mts";
export { pruneStaleEarlierAttemptSuites } from "./stale-attempt-prune.mts";

export type { CheckArgs, CheckRunResult, EvaluatedCheck } from "./commands/check.mts";
export type { StorePutArgs } from "./commands/store-put.mts";
export type { MergeArgs } from "./commands/merge.mts";
export type {
  ExpectedSuite,
  PrepareArtifactsArgs,
  PrepareArtifactsResult,
} from "./commands/prepare-artifacts.mts";
export type { SnapshotSuiteStore, SuiteStore, SuiteMeta } from "./suite-store.mts";
export type { S3SuiteStoreOptions } from "./s3-suite-store.mts";
export type {
  BaselineSnapshot,
  BaselineSnapshotEntry,
  BaselineSnapshotWriteResult,
  ResolvedSuiteVersion,
} from "./baseline-snapshot.mts";
export { computeCoverageDrop } from "./coverage-drop.mts";
export type { FullLcovData, FullFileCoverage } from "./lcov-records.mts";
export type {
  ExpectedProvenanceSuite,
  PrepareProvenanceArtifactsOptions,
  ProvenanceArtifactSource,
  SelectedProvenanceArtifact,
} from "./provenance-artifact-types.mts";
export type {
  CoverageArtifactDescriptor,
  CoverageCollectorName,
  CoverageCollectorProfile,
  CoverageManifest,
  CoverageRun,
  CoverageSuiteDescriptor,
  ExpectedCoverageRun,
  StampCoverageManifestOptions,
  ValidateCoverageManifestOptions,
} from "./provenance-types.mts";
export type { ExpectedCollectorVersionOptions } from "./provenance-policy.mts";
export type { PruneStaleEarlierAttemptSuitesOptions } from "./stale-attempt-prune.mts";

export type {
  CoverageCheckResult,
  BucketResult,
  DropResult,
  FileCoverageResult,
  LcovData,
  DiffLines,
  DiffLineContent,
  CoverageRule,
  CoverageConfig,
  CoverageScope,
  CoverageDisposition,
  MissingCoverageResult,
} from "./types.mts";

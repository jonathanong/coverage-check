import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { COVERAGE_MANIFEST_FILENAME } from "./provenance-types.mts";

type ProvenanceOutputPair = {
  suite: string;
  lcov: Buffer;
  manifestBytes: Buffer;
};

export type ProvenanceOutputOperationOverrides = Partial<{
  exists: (path: string) => boolean;
  mkdir: (path: string, recursive?: boolean) => void;
  mkdtemp: (prefix: string) => string;
  rename: (from: string, to: string) => void;
  remove: (path: string) => void;
  write: (path: string, data: Buffer, mode?: number) => void;
}>;

function createOperations(overrides: ProvenanceOutputOperationOverrides) {
  return {
    exists: existsSync,
    mkdir: (path: string, recursive = false) => {
      mkdirSync(path, { recursive });
    },
    mkdtemp: mkdtempSync,
    rename: renameSync,
    remove: (path: string) => {
      rmSync(path, { recursive: true, force: true });
    },
    write: (path: string, data: Buffer, mode?: number) => {
      writeFileSync(path, data, mode === undefined ? undefined : { mode });
    },
    ...overrides,
  };
}

function throwWithRollbackErrors(error: unknown, rollbackErrors: unknown[]): never {
  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      [error, ...rollbackErrors],
      "Coverage artifact commit and rollback both failed",
    );
  }
  throw error;
}

export function replaceProvenanceOutput(
  outputDirectory: string,
  selected: readonly ProvenanceOutputPair[],
  overrides: ProvenanceOutputOperationOverrides = {},
): void {
  const operations = createOperations(overrides);
  const parent = dirname(outputDirectory);
  operations.mkdir(parent, true);
  const staging = operations.mkdtemp(join(parent, `.${basename(outputDirectory)}-staging-`));
  const backup = join(parent, `.${basename(outputDirectory)}-backup-${process.pid}-${Date.now()}`);
  let movedExisting = false;
  let committed = false;

  try {
    for (const pair of selected) {
      const destination = join(staging, `coverage-${pair.suite}`);
      operations.mkdir(destination);
      operations.write(join(destination, "lcov.info"), pair.lcov);
      operations.write(join(destination, COVERAGE_MANIFEST_FILENAME), pair.manifestBytes, 0o600);
    }
    if (operations.exists(outputDirectory)) {
      operations.rename(outputDirectory, backup);
      movedExisting = true;
    }
    operations.rename(staging, outputDirectory);
    committed = true;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    try {
      operations.remove(staging);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    try {
      if (movedExisting && !operations.exists(outputDirectory) && operations.exists(backup)) {
        operations.rename(backup, outputDirectory);
      }
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    throwWithRollbackErrors(error, rollbackErrors);
  }
  if (committed && movedExisting) {
    try {
      operations.remove(backup);
    } catch {
      // The new output is committed; a stale backup is safer than reporting a false failure.
    }
  }
}

export function replaceCoveragePairFiles(
  lcovPath: string,
  manifestPath: string,
  lcov: Buffer,
  manifest: Buffer,
  overrides: ProvenanceOutputOperationOverrides = {},
): void {
  const parent = dirname(lcovPath);
  if (dirname(manifestPath) !== parent || lcovPath === manifestPath) {
    throw new Error("LCOV and coverage manifest must be distinct files in the same directory");
  }
  const operations = createOperations(overrides);
  operations.mkdir(parent, true);
  const staging = operations.mkdtemp(join(parent, ".coverage-pair-staging-"));
  const backup = operations.mkdtemp(join(parent, ".coverage-pair-backup-"));
  const stagedLcov = join(staging, "lcov.info");
  const stagedManifest = join(staging, COVERAGE_MANIFEST_FILENAME);
  const backupLcov = join(backup, "lcov.info");
  const backupManifest = join(backup, COVERAGE_MANIFEST_FILENAME);
  let backedUpLcov = false;
  let backedUpManifest = false;
  let committedLcov = false;
  let committedManifest = false;

  try {
    operations.write(stagedLcov, lcov);
    operations.write(stagedManifest, manifest, 0o600);
    if (operations.exists(lcovPath)) {
      operations.rename(lcovPath, backupLcov);
      backedUpLcov = true;
    }
    if (operations.exists(manifestPath)) {
      operations.rename(manifestPath, backupManifest);
      backedUpManifest = true;
    }
    operations.rename(stagedLcov, lcovPath);
    committedLcov = true;
    operations.rename(stagedManifest, manifestPath);
    committedManifest = true;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    const rollback = (action: () => void) => {
      try {
        action();
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    };
    if (committedLcov) rollback(() => operations.remove(lcovPath));
    if (committedManifest) rollback(() => operations.remove(manifestPath));
    if (backedUpLcov) rollback(() => operations.rename(backupLcov, lcovPath));
    if (backedUpManifest) rollback(() => operations.rename(backupManifest, manifestPath));
    rollback(() => operations.remove(staging));
    rollback(() => operations.remove(backup));
    throwWithRollbackErrors(error, rollbackErrors);
  }
  try {
    operations.remove(staging);
    operations.remove(backup);
  } catch {
    // Both files are committed; stale temporary data is safer than reporting a false failure.
  }
}

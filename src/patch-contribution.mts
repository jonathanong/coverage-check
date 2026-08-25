import { readFileSync } from "node:fs";
import { parseLcov } from "./lcov-parser.mts";
import { toLcov } from "./lcov-merge.mts";
import { getChangedLines } from "./diff-parser.mts";
import {
  canonicalize,
  digest,
  normalizeSources,
  sourceRootDigest,
  validateRevision,
} from "./provenance-integrity.mts";
import { replaceCoveragePairFiles } from "./provenance-artifact-output.mts";
import { serializeCoverageManifest } from "./provenance.mts";
import type {
  CoverageArtifactDescriptor,
  CoverageRun,
  PatchCoverageManifest,
} from "./provenance-types.mts";

export const PATCH_LCOV_ALGORITHM = "git-merge-base-diff-v1" as const;

export type PatchProducerPartition = { index: number; total: number };

export type CreatePatchCoverageContributionOptions = {
  root: string;
  lcovPath: string;
  manifestPath: string;
  descriptor: CoverageArtifactDescriptor;
  repository: string;
  revision: string;
  run: CoverageRun;
  collectorVersion: string;
  base: string;
  head: string;
  producer: PatchProducerPartition;
};

export function changedLinesDigest(changedLines: ReadonlyMap<string, ReadonlySet<number>>): string {
  const canonical = [...changedLines]
    .map(([file, lines]) => [file, [...lines].toSorted((a, b) => a - b)] as const)
    .toSorted(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)));
  return digest(`${JSON.stringify(canonicalize(canonical))}\n`);
}

/** Lossless projection used by producers and directly testable by non-Git consumers. */
export function projectPatchLcov(
  normalizedLcov: string,
  changedLines: ReadonlyMap<string, ReadonlySet<number>>,
): string {
  const parsed = parseLcov(normalizedLcov);
  const sparse = new Map<string, Map<number, number>>();
  for (const [file, report] of parsed) {
    const lines = changedLines.get(file);
    if (!lines) continue;
    sparse.set(file, new Map([...report].filter(([line]) => lines.has(line))));
  }
  return toLcov(sparse);
}

function validateOptions(options: CreatePatchCoverageContributionOptions): void {
  validateRevision(options.revision);
  validateRevision(options.base);
  validateRevision(options.head);
  if (!options.repository || !options.descriptor.suite || !options.collectorVersion) {
    throw new Error("Patch coverage contribution identity is incomplete");
  }
  if (
    !Number.isSafeInteger(options.producer.index) ||
    !Number.isSafeInteger(options.producer.total) ||
    options.producer.index < 1 ||
    options.producer.total < options.producer.index
  ) {
    throw new Error("Patch coverage producer partition must be a positive index within its total");
  }
}

/**
 * Atomically replaces a full LCOV report with its lossless projection onto the canonical patch.
 * The result preserves changed-file SF records even when no changed DA record exists.
 */
export async function createPatchCoverageContribution(
  options: CreatePatchCoverageContributionOptions,
): Promise<PatchCoverageManifest> {
  validateOptions(options);
  const raw = readFileSync(options.lcovPath, "utf8");
  const { normalizedLcov, sources } = normalizeSources(options.root, raw);
  const changedLines = await getChangedLines(options.base, options.head, options.root);
  const parsed = parseLcov(normalizedLcov);
  const sparseSources: { relativePath: string; absolutePath: string }[] = [];
  for (const source of sources) {
    const lines = changedLines.get(source.relativePath);
    if (!lines || !parsed.has(source.relativePath)) continue;
    sparseSources.push(source);
  }
  const sparseLcov = Buffer.from(projectPatchLcov(normalizedLcov, changedLines));
  const manifest: PatchCoverageManifest = {
    version: 2,
    kind: "patch-lcov",
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
    lcov: { bytes: sparseLcov.byteLength, sha256: digest(sparseLcov) },
    sourceRoot: {
      algorithm: "sha256-coverage-check-lcov-source-files-v1",
      files: sparseSources.length,
      sha256: sourceRootDigest(sparseSources),
    },
    patch: {
      algorithm: PATCH_LCOV_ALGORITHM,
      base: options.base,
      head: options.head,
      changedLinesSha256: changedLinesDigest(changedLines),
    },
    producer: options.producer,
  };
  const manifestBytes = Buffer.from(serializeCoverageManifest(manifest));
  replaceCoveragePairFiles(options.lcovPath, options.manifestPath, sparseLcov, manifestBytes);
  return manifest;
}

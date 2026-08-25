import { readFileSync } from "node:fs";
import { parseLcov } from "./lcov-parser.mts";
import { mergeLcov } from "./lcov-merge.mts";
import { getChangedLines } from "./diff-parser.mts";
import {
  digest,
  normalizeSources,
  sourceRootDigest,
  validateRevision,
} from "./provenance-integrity.mts";
import { parsePatchCoverageManifest } from "./provenance-schema.mts";
import type { CoverageArtifactDescriptor, PatchCoverageManifest } from "./provenance-types.mts";
import { changedLinesDigest } from "./patch-contribution.mts";

export type ValidatePatchCoverageContributionOptions = {
  root: string;
  lcovPath: string;
  manifestPath: string;
  descriptor: CoverageArtifactDescriptor;
  repository: string;
  revision: string;
  run: { id: string; currentAttempt: number };
  base: string;
  head: string;
  expectedCollectorVersion?: string;
};

export async function validatePatchCoverageContribution(
  options: ValidatePatchCoverageContributionOptions,
): Promise<PatchCoverageManifest> {
  validateRevision(options.revision);
  const lcov = readFileSync(options.lcovPath);
  const manifest = parsePatchCoverageManifest(
    JSON.parse(readFileSync(options.manifestPath, "utf8")),
  );
  const expectedLines = await getChangedLines(options.base, options.head, options.root);
  if (
    manifest.repository !== options.repository ||
    manifest.revision !== options.revision ||
    manifest.suite !== options.descriptor.suite ||
    JSON.stringify(manifest.projects) !== JSON.stringify(options.descriptor.projects) ||
    manifest.collector.name !== options.descriptor.collector.name ||
    JSON.stringify(manifest.collector.settings) !==
      JSON.stringify(options.descriptor.collector.settings) ||
    (options.expectedCollectorVersion !== undefined &&
      manifest.collector.version !== options.expectedCollectorVersion) ||
    manifest.run.id !== options.run.id ||
    manifest.run.attempt > options.run.currentAttempt ||
    manifest.patch.base !== options.base ||
    manifest.patch.head !== options.head ||
    manifest.patch.changedLinesSha256 !== changedLinesDigest(expectedLines) ||
    manifest.lcov.bytes !== lcov.byteLength ||
    manifest.lcov.sha256 !== digest(lcov)
  )
    throw new Error("Patch coverage manifest identity does not match the expected contribution");
  if (lcov.byteLength === 0) {
    if (manifest.sourceRoot.files !== 0 || manifest.sourceRoot.sha256 !== sourceRootDigest([]))
      throw new Error("Patch coverage manifest source-root integrity check failed");
    return manifest;
  }
  const { normalizedLcov, sources } = normalizeSources(options.root, lcov.toString("utf8"));
  if (
    normalizedLcov !== lcov.toString("utf8") ||
    manifest.sourceRoot.files !== sources.length ||
    manifest.sourceRoot.sha256 !== sourceRootDigest(sources)
  )
    throw new Error("Patch coverage manifest source-root integrity check failed");
  const report = parseLcov(normalizedLcov);
  for (const [file, lines] of report) {
    const allowed = expectedLines.get(file);
    if (!allowed || [...lines.keys()].some((line) => !allowed.has(line)))
      throw new Error("Patch coverage LCOV contains lines outside the canonical patch");
  }
  return manifest;
}

export function mergePatchCoverageContributions(
  lcovs: readonly Buffer[],
): ReturnType<typeof mergeLcov> {
  return mergeLcov(lcovs.map((lcov) => parseLcov(lcov.toString("utf8"))));
}

/** Validates self-described producer completeness without a repository shard catalog. */
export function validatePatchCoveragePartitions(
  manifests: readonly Pick<PatchCoverageManifest, "producer">[],
): void {
  const groups = new Map<string, { total: number; indices: Set<number> }>();
  for (const { producer } of manifests) {
    let group = groups.get(producer.group);
    if (!group) {
      group = { total: producer.total, indices: new Set() };
      groups.set(producer.group, group);
    }
    if (group.total !== producer.total) {
      throw new Error(`Patch coverage producer group ${producer.group} has contradictory totals`);
    }
    if (producer.index < 1 || producer.index > group.total || group.indices.has(producer.index)) {
      throw new Error(`Patch coverage producer group ${producer.group} has an invalid partition`);
    }
    group.indices.add(producer.index);
  }
  for (const [name, group] of groups) {
    if (group.indices.size !== group.total) {
      throw new Error(`Patch coverage producer group ${name} is missing partitions`);
    }
  }
}

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { replaceProvenanceOutput } from "./provenance-artifact-output.mts";
import { COVERAGE_MANIFEST_FILENAME } from "./provenance.mts";
import {
  validatePatchCoverageContribution,
  validatePatchCoveragePartitions,
} from "./patch-contribution-validation.mts";
import type { CoverageArtifactDescriptor, PatchCoverageManifest } from "./provenance-types.mts";

export type PatchCoverageArtifactSource = { name: string; directory: string };
export type SelectedPatchCoverageArtifact = {
  suite: string;
  sources: readonly string[];
  manifest: PatchCoverageManifest;
};
export type PreparePatchCoverageArtifactsOptions = {
  root: string;
  sources: readonly PatchCoverageArtifactSource[];
  outputDirectory: string;
  repository: string;
  revision: string;
  run: { id: string; currentAttempt: number };
  base: string;
  head: string;
  /**
   * Producer groups selected by the current successful jobs. When provided, groups that are no
   * longer selected may be discarded only when all of their contributions predate this attempt.
   */
  expectedProducerGroups?: readonly string[];
  resolveDescriptor: (
    suite: string,
  ) => { descriptor: CoverageArtifactDescriptor; expectedCollectorVersion?: string } | undefined;
};

/** Bounds untrusted manifest metadata before including it in a GitHub Actions annotation. */
function boundedProducerGroup(group: string): string {
  return group.length > 80 ? `${group.slice(0, 77)}...` : group;
}

/**
 * Applies a caller's current producer selection without discarding valid earlier-attempt work.
 */
function filterSelectedProducerGroups<T extends { manifest: PatchCoverageManifest }>(
  selected: readonly T[],
  expectedProducerGroups: readonly string[] | undefined,
  currentAttempt: number,
): readonly T[] {
  if (expectedProducerGroups === undefined) return selected;
  const expected = new Set(expectedProducerGroups);
  const groups = new Map<string, T[]>();
  for (const contribution of selected) {
    const group = contribution.manifest.producer.group;
    groups.set(group, [...(groups.get(group) ?? []), contribution]);
  }
  for (const group of expected) {
    if (!groups.has(group))
      throw new Error(`Missing expected patch coverage producer group: ${group}`);
  }
  return selected.filter((contribution) => {
    const group = contribution.manifest.producer.group;
    if (expected.has(group)) return true;
    const groupContributions = groups.get(group)!;
    if (groupContributions.some(({ manifest }) => manifest.run.attempt === currentAttempt)) {
      throw new Error(`Unexpected current-attempt patch coverage producer group: ${group}`);
    }
    if (groupContributions.every(({ manifest }) => manifest.run.attempt < currentAttempt)) {
      if (groupContributions[0] === contribution) {
        process.stdout.write(
          `::notice::Pruned stale earlier-attempt patch coverage producer group: ${boundedProducerGroup(group)}\n`,
        );
      }
      return false;
    }
    throw new Error(`Unexpected patch coverage producer group: ${group}`);
  });
}

/** Selects, validates, and atomically prepares patch coverage artifacts for a fan-in check. */
export async function preparePatchCoverageArtifacts(
  options: PreparePatchCoverageArtifactsOptions,
): Promise<{ selected: readonly SelectedPatchCoverageArtifact[] }> {
  const found = new Map<
    string,
    { source: string; lcov: Buffer; manifestBytes: Buffer; manifest: PatchCoverageManifest }[]
  >();
  for (const source of options.sources) {
    if (!existsSync(source.directory)) continue;
    for (const entry of readdirSync(source.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("coverage-"))
        throw new Error(`Unexpected ${source.name} coverage artifact entry: ${entry.name}`);
      const suite = entry.name.slice(9);
      const resolved = options.resolveDescriptor(suite);
      if (!resolved) throw new Error(`Unexpected ${source.name} coverage suite: ${suite}`);
      const directory = join(source.directory, entry.name);
      const lcovPath = join(directory, "lcov.info");
      const manifestPath = join(directory, COVERAGE_MANIFEST_FILENAME);
      if (!existsSync(lcovPath) || !existsSync(manifestPath))
        throw new Error(`Missing patch coverage pair for ${suite}`);
      const manifest = await validatePatchCoverageContribution({
        root: options.root,
        lcovPath,
        manifestPath,
        descriptor: resolved.descriptor,
        repository: options.repository,
        revision: options.revision,
        run: options.run,
        base: options.base,
        head: options.head,
        expectedCollectorVersion: resolved.expectedCollectorVersion,
      });
      const list = found.get(suite) ?? [];
      list.push({
        source: source.name,
        lcov: readFileSync(lcovPath),
        manifestBytes: readFileSync(manifestPath),
        manifest,
      });
      found.set(suite, list);
    }
  }
  const selected: {
    suite: string;
    sources: string[];
    manifest: PatchCoverageManifest;
    lcov: Buffer;
    manifestBytes: Buffer;
  }[] = [];
  for (const [suite, entries] of found) {
    const latest = Math.max(...entries.map((entry) => entry.manifest.run.attempt));
    const valid = entries.filter((entry) => entry.manifest.run.attempt === latest);
    const first = valid[0]!;
    if (
      valid.some(
        (entry) =>
          !entry.lcov.equals(first.lcov) || !entry.manifestBytes.equals(first.manifestBytes),
      )
    )
      throw new Error(`Coverage sources contain conflicting valid pairs for suite ${suite}`);
    selected.push({
      suite,
      sources: valid.map((entry) => entry.source),
      manifest: first.manifest,
      lcov: first.lcov,
      manifestBytes: first.manifestBytes,
    });
  }
  const filtered = filterSelectedProducerGroups(
    selected,
    options.expectedProducerGroups,
    options.run.currentAttempt,
  );
  validatePatchCoveragePartitions(filtered.map(({ manifest }) => manifest));
  replaceProvenanceOutput(options.outputDirectory, filtered);
  return {
    selected: filtered.map(({ suite, sources, manifest }) => ({ suite, sources, manifest })),
  };
}

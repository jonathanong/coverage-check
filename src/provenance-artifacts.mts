import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { replaceProvenanceOutput } from "./provenance-artifact-output.mts";
import { COVERAGE_MANIFEST_FILENAME, validateCoverageManifestBytes } from "./provenance.mts";
import { validatePathComponent } from "./provenance-integrity.mts";
import type {
  PrepareProvenanceArtifactsOptions,
  ProvenanceArtifactSource,
  SelectedProvenanceArtifact,
} from "./provenance-artifact-types.mts";
import type { CoverageManifest } from "./provenance-types.mts";

type ValidPair = {
  source: string;
  lcov: Buffer;
  manifestBytes: Buffer;
  manifest: CoverageManifest;
};

type Candidate = {
  pair?: ValidPair;
  error?: string;
};

type SelectedPair = SelectedProvenanceArtifact & {
  lcov: Buffer;
  manifestBytes: Buffer;
};

function inspectSource(
  source: ProvenanceArtifactSource,
  options: PrepareProvenanceArtifactsOptions,
): ReadonlyMap<string, Candidate> {
  const expectations = new Map(
    options.expectedSuites.map((expected) => [expected.descriptor.suite, expected]),
  );
  const candidates = new Map<string, Candidate>();
  if (!existsSync(source.directory)) return candidates;

  for (const entry of readdirSync(source.directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("coverage-")) {
      throw new Error(`Unexpected ${source.name} coverage artifact entry: ${entry.name}`);
    }
    const suite = entry.name.slice("coverage-".length);
    const expected = expectations.get(suite);
    if (!expected) throw new Error(`Unexpected ${source.name} coverage suite: ${suite}`);
    /* c8 ignore next -- directory entries cannot repeat a name, retained as a defensive invariant */
    if (candidates.has(suite)) {
      throw new Error(`Duplicate ${source.name} coverage suite: ${suite}`);
    }

    const pairDirectory = join(source.directory, entry.name);
    const entries = readdirSync(pairDirectory, { withFileTypes: true });
    const names = entries
      .map((candidate) => candidate.name)
      .toSorted((left, right) => left.localeCompare(right));
    const expectedNames = [COVERAGE_MANIFEST_FILENAME, "lcov.info"];
    if (
      entries.some((candidate) => !candidate.isFile()) ||
      names.join("\0") !==
        expectedNames.toSorted((left, right) => left.localeCompare(right)).join("\0")
    ) {
      candidates.set(suite, {
        error: `${source.name} coverage pair for ${suite} must contain exactly ${expectedNames.join(", ")}`,
      });
      continue;
    }

    const lcovPath = join(pairDirectory, "lcov.info");
    const manifestPath = join(pairDirectory, COVERAGE_MANIFEST_FILENAME);
    try {
      const lcov = readFileSync(lcovPath);
      const manifestBytes = readFileSync(manifestPath);
      const manifest = validateCoverageManifestBytes(
        {
          root: options.root,
          lcovPath,
          manifestPath,
          descriptor: expected.descriptor,
          repository: options.repository,
          revision: options.revision,
          expectedRun: options.expectedRun,
          expectedCollectorVersion: expected.expectedCollectorVersion,
        },
        lcov,
        manifestBytes,
      );
      candidates.set(suite, {
        pair: {
          source: source.name,
          lcov,
          manifestBytes,
          manifest,
        },
      });
    } catch (error) {
      candidates.set(suite, {
        error: `${source.name} coverage pair for ${suite} is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  return candidates;
}

function selectArtifacts(
  candidatesBySource: readonly ReadonlyMap<string, Candidate>[],
  options: PrepareProvenanceArtifactsOptions,
): SelectedPair[] {
  return options.expectedSuites.map((expected) => {
    const suite = expected.descriptor.suite;
    const candidates = candidatesBySource
      .map((source) => source.get(suite))
      .filter((candidate): candidate is Candidate => candidate !== undefined);
    const valid = candidates
      .map((candidate) => candidate.pair)
      .filter((pair): pair is ValidPair => pair !== undefined);
    if (valid.length === 0) {
      const diagnostics = candidates
        .map((candidate) => candidate.error)
        .filter((error): error is string => error !== undefined)
        .join("; ");
      throw new Error(
        `Missing valid coverage artifact for ${expected.producer}: coverage-${suite}/lcov.info and ${COVERAGE_MANIFEST_FILENAME}${
          diagnostics ? ` (${diagnostics})` : ""
        }`,
      );
    }

    const selected = valid[0]!;
    if (
      valid.some(
        (pair) =>
          !pair.lcov.equals(selected.lcov) || !pair.manifestBytes.equals(selected.manifestBytes),
      )
    ) {
      throw new Error(`Coverage sources contain conflicting valid pairs for suite ${suite}`);
    }
    return {
      suite,
      sources: valid.map((pair) => pair.source),
      manifest: selected.manifest,
      lcov: selected.lcov,
      manifestBytes: selected.manifestBytes,
    };
  });
}

export function prepareProvenanceArtifacts(options: PrepareProvenanceArtifactsOptions): {
  selected: readonly SelectedProvenanceArtifact[];
} {
  if (options.sources.length === 0) throw new Error("At least one coverage source is required");
  if (options.expectedSuites.length === 0) {
    throw new Error("At least one expected coverage suite is required");
  }
  const sourceNames = options.sources.map((source) => source.name);
  for (const sourceName of sourceNames) validatePathComponent(sourceName, "Coverage source name");
  if (new Set(sourceNames).size !== sourceNames.length) {
    throw new Error("Duplicate coverage source name");
  }

  const suiteNames = options.expectedSuites.map((expected) => expected.descriptor.suite);
  for (const suiteName of suiteNames) validatePathComponent(suiteName, "Coverage suite");
  if (new Set(suiteNames).size !== suiteNames.length) {
    throw new Error("Duplicate expected coverage suite");
  }

  const candidates = options.sources.map((source) => inspectSource(source, options));
  const selected = selectArtifacts(candidates, options);
  const publicSelection = selected.map(({ suite, sources, manifest }) => ({
    suite,
    sources,
    manifest,
  }));
  options.validateSelection?.(publicSelection);
  replaceProvenanceOutput(options.outputDirectory, selected);
  return { selected: publicSelection };
}

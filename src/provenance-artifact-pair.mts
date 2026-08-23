import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COVERAGE_MANIFEST_FILENAME, validateCoverageManifestBytes } from "./provenance.mts";
import type {
  ExpectedProvenanceSuite,
  PrepareProvenanceArtifactsOptions,
} from "./provenance-artifact-types.mts";
import type { CoverageManifest } from "./provenance-types.mts";

export type ValidProvenancePair = {
  source: string;
  lcov: Buffer;
  manifestBytes: Buffer;
  manifest: CoverageManifest;
};

export type ProvenancePairCandidate = {
  pair?: ValidProvenancePair;
  error?: string;
};

export function inspectProvenancePair(
  sourceName: string,
  pairDirectory: string,
  expected: ExpectedProvenanceSuite,
  options: PrepareProvenanceArtifactsOptions,
): ProvenancePairCandidate {
  const suite = expected.descriptor.suite;
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
    return { pair: { source: sourceName, lcov, manifestBytes, manifest } };
  } catch (error) {
    return {
      error: `${sourceName} coverage pair for ${suite} is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

import type {
  CoverageArtifactDescriptor,
  CoverageManifest,
  ExpectedCoverageRun,
} from "./provenance-types.mts";

export type ProvenanceArtifactSource = {
  name: string;
  directory: string;
};

export type ExpectedProvenanceSuite = {
  producer: string;
  descriptor: CoverageArtifactDescriptor;
  expectedCollectorVersion?: string;
};

export type SelectedProvenanceArtifact = {
  suite: string;
  sources: readonly string[];
  manifest: CoverageManifest;
};

export type PrepareProvenanceArtifactsOptions = {
  root: string;
  sources: readonly ProvenanceArtifactSource[];
  outputDirectory: string;
  expectedSuites: readonly ExpectedProvenanceSuite[];
  repository: string;
  revision: string;
  expectedRun: ExpectedCoverageRun | null;
  validateSelection?: (selected: readonly SelectedProvenanceArtifact[]) => void;
};

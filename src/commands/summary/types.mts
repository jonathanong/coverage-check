import type { LcovData } from "../../types.mts";

export type { LcovData };

export type Source = "current" | "history";

export type SuiteCoverage = {
  suite: string;
  source: Source;
  branch?: string;
  lcov: LcovData;
};

export type SourceCoverageGroup = {
  folder: string;
  source: Source | "mixed";
  branchesLabel?: string;
  lcov: LcovData;
};

export type CoverageTotals = {
  hit: number;
  total: number;
};

export type CoverageSummary = {
  currentTotals: CoverageTotals;
  groups: SourceCoverageGroup[];
  suites: SuiteCoverage[];
  totals: CoverageTotals;
  warnings: string[];
};

export type CoverageSummaryArgs = {
  activeSuites: string[];
  artifacts: string;
  branch: string;
  rulesFile?: string;
  storeFs: string | null;
  storeS3: string | null;
  summaryFile: string | null;
  stripPrefixes: string[];
};

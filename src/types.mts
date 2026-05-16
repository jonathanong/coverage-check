export type CoverageRule = {
  paths: string;
  patch_coverage_min: number;
};

export type CoverageRules = {
  rules: CoverageRule[];
};

/** Map from repo-root-relative file path to map of line number → hit count. */
export type LcovData = Map<string, Map<number, number>>;

/** Map from repo-root-relative file path to set of added/modified line numbers. */
export type DiffLines = Map<string, Set<number>>;

export type FileCoverageResult = {
  file: string;
  coverable: number;
  hit: number;
  uncoveredLines: number[];
  rule: string | null;
};

export type BucketResult = {
  rule: string;
  threshold: number;
  coverable: number;
  hit: number;
  files: FileCoverageResult[];
  passed: boolean;
};

export type CoverageCheckResult = {
  buckets: BucketResult[];
  informational: FileCoverageResult[];
  passed: boolean;
};

export type SuiteMeta = {
  sha?: string;
  branch?: string;
  timestamp?: string;
};

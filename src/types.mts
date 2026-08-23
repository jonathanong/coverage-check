export type CoverageRule = {
  paths: string;
  patch_coverage_min: number;
  no_coverage_drop?: boolean;
  max_coverage_drop?: number;
};

/** Map from repo-root-relative file path to map of added line number → trimmed source text. */
export type DiffLineContent = Map<string, Map<number, string>>;

export type CoverageRules = {
  rules: CoverageRule[];
  scope?: CoverageScope;
};

export type CoverageDisposition = "aggregate" | "supplemental" | "ignored";

export type CoverageScope = {
  version: 1;
  analyzer: "javascript";
  include: string[];
  ignored?: string[];
  supplemental?: string[];
};

export type CoverageConfig = {
  rules: CoverageRule[];
  scope?: CoverageScope;
};

export type MissingCoverageResult = {
  file: string;
  lines: number[];
  rule: string;
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

export type DropResult = {
  rule: string;
  currentPct: number | null; // null if no current data
  baselinePct: number | null; // null if no baseline data
  drop: number | null; // baselinePct - currentPct, null if either is null
  maxDrop: number; // max_coverage_drop ?? 0
  passed: boolean;
  skipped: boolean; // true when baseline unavailable (non-blocking)
};

export type CoverageCheckResult = {
  buckets: BucketResult[];
  drops: DropResult[];
  informational: FileCoverageResult[];
  missingCoverage: MissingCoverageResult[];
  passed: boolean;
};

export type SuiteMeta = {
  sha?: string;
  branch?: string;
  timestamp?: string;
};

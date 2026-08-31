export const coverageSummaryMetrics = ["lines", "statements", "functions", "branches"] as const;

export type CoverageSummaryMetricName = (typeof coverageSummaryMetrics)[number];

export type CoverageSummaryCount = { covered: number; total: number };

export type IstanbulCoverageSummaryMetric = CoverageSummaryCount & {
  pct?: number;
  skipped?: number;
};

/** The file-keyed shape written by Istanbul's coverage-summary JSON reporter. */
export type IstanbulCoverageSummary = Record<
  string,
  Partial<Record<CoverageSummaryMetricName, IstanbulCoverageSummaryMetric>>
>;

export type CoverageSummaryTotals = Record<
  CoverageSummaryMetricName,
  CoverageSummaryCount & { pct: number }
>;

export type CoverageSummaryRegression =
  | { kind: "missing-file"; file: string }
  | {
      kind: "aggregate-decrease";
      metric: CoverageSummaryMetricName;
      base: CoverageSummaryCount & { pct: number };
      head: CoverageSummaryCount & { pct: number };
    }
  | {
      kind: "decrease";
      file: string;
      metric: CoverageSummaryMetricName;
      base: CoverageSummaryCount & { pct: number };
      head: CoverageSummaryCount & { pct: number };
    };

export type CoverageSummaryComparison = {
  passed: boolean;
  base: CoverageSummaryTotals;
  head: CoverageSummaryTotals;
  regressions: CoverageSummaryRegression[];
};

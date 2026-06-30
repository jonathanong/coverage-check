import type { CoverageCheckResult } from "../types.mts";

export type CheckRunResult = {
  result: CoverageCheckResult | null;
  exitCode: 0 | 1 | 2;
  advisory: boolean;
  skipped: boolean;
  error: string | null;
  warnings: string[];
};

export type CheckJsonPayload = CoverageCheckResult & {
  exitCode: 0 | 1 | 2;
  advisory: boolean;
  skipped: boolean;
  error?: string;
};

export function emptyResult(passed: boolean): CoverageCheckResult {
  return { buckets: [], drops: [], informational: [], passed };
}

export function toJsonPayload(check: CheckRunResult): CheckJsonPayload {
  return {
    ...(check.result ?? emptyResult(false)),
    exitCode: check.exitCode,
    advisory: check.advisory,
    skipped: check.skipped,
    ...(check.error === null ? {} : { error: check.error }),
  };
}

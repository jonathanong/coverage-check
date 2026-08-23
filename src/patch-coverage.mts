import type {
  BucketResult,
  CoverageRule,
  DiffLines,
  FileCoverageResult,
  LcovData,
  CoverageScope,
  MissingCoverageResult,
} from "./types.mts";
import { matchRule } from "./rules.mts";
import { findMissingCoverage } from "./scope.mts";

export function computePatchCoverage(
  diff: DiffLines,
  lcov: LcovData,
  rules: CoverageRule[],
  scope?: CoverageScope,
  readSource?: (path: string) => string,
): {
  buckets: BucketResult[];
  informational: FileCoverageResult[];
  missingCoverage: MissingCoverageResult[];
} {
  const bucketMap = new Map<string, BucketResult>();
  const informational: FileCoverageResult[] = [];

  for (const [file, changedLineSet] of diff) {
    const fileLines = lcov.get(file);
    if (fileLines === undefined) continue; // not in lcov scope — skip

    const coverable: number[] = [];
    const uncoveredLines: number[] = [];
    let hit = 0;

    for (const lineNo of changedLineSet) {
      if (!fileLines.has(lineNo)) continue; // line not tracked by coverage
      coverable.push(lineNo);
      if (fileLines.get(lineNo)! > 0) {
        hit++;
      } else {
        uncoveredLines.push(lineNo);
      }
    }

    if (coverable.length === 0) continue;

    const rule = matchRule(file, rules);
    const fileResult: FileCoverageResult = {
      file,
      coverable: coverable.length,
      hit,
      uncoveredLines: uncoveredLines.sort((a, b) => a - b),
      rule: rule?.paths ?? null,
    };

    if (rule === null) {
      informational.push(fileResult);
      continue;
    }

    let bucket = bucketMap.get(rule.paths);
    if (bucket === undefined) {
      bucket = {
        rule: rule.paths,
        threshold: rule.patch_coverage_min,
        coverable: 0,
        hit: 0,
        files: [],
        passed: true,
      };
      bucketMap.set(rule.paths, bucket);
    }

    bucket.coverable += coverable.length;
    bucket.hit += hit;
    bucket.files.push(fileResult);
  }

  const buckets = [...bucketMap.values()];
  for (const bucket of buckets) {
    /* c8 ignore next -- bucket always has coverable>0 (L36 guard prevents empty-coverable files from reaching bucketMap) */
    if (bucket.coverable === 0) {
      bucket.passed = true;
    } else {
      const pct = (bucket.hit / bucket.coverable) * 100;
      bucket.passed = pct >= bucket.threshold;
    }
  }

  return {
    buckets,
    informational,
    missingCoverage: scope ? findMissingCoverage(diff, lcov, rules, scope, readSource) : [],
  };
}

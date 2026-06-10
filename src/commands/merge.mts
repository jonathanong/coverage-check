import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { parseLcovFull, mergeLcovFull, toLcovFull } from "../lcov-records.mts";
import { checkRequiredArtifacts } from "./check-output.mts";
import { parseMergeArgs } from "./merge-args.mts";
import type { MergeArgs } from "./merge-args.mts";
export type { MergeArgs } from "./merge-args.mts";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

export async function main(argv: string[]): Promise<number> {
  let args: MergeArgs;
  try {
    args = parseMergeArgs(argv);
  } catch (err) {
    stderr(`coverage-check merge: ${String(err)}`);
    return 2;
  }
  return runMerge(args);
}

/**
 * Merges all lcov.info files found under args.artifacts into a single full-fidelity LCOV file.
 * Preserves FN/FNDA/BRDA records and recomputes summary counters (FNF/FNH/BRF/BRH/LF/LH).
 * Hit counts are summed across reports (lines, function hits, branch hits).
 */
export function runMerge(args: MergeArgs): number {
  if (!checkRequiredArtifacts(args.artifacts, args.requireArtifacts)) return 2;

  const lcovFiles = collectLcovFiles(args.artifacts);
  if (lcovFiles.length === 0) {
    stderr(`coverage-check merge: no lcov.info files found under ${args.artifacts}`);
    return 1;
  }

  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const reports = lcovFiles.map((f) => parseLcovFull(readFileSync(f, "utf8"), stripPrefixes));
  const merged = mergeLcovFull(reports);
  const lcovText = toLcovFull(merged);

  mkdirSync(dirname(args.output), { recursive: true });
  writeFileSync(args.output, lcovText, "utf8");
  stdout(`coverage-check merge: merged ${lcovFiles.length} file(s) → ${args.output}`);
  return 0;
}

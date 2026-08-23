import { readFileSync } from "node:fs";
import { transformSync, type Loader } from "esbuild";
import { eachMapping, TraceMap } from "@jridgewell/trace-mapping";
import { minimatch } from "minimatch";
import type {
  CoverageDisposition,
  CoverageScope,
  DiffLines,
  LcovData,
  MissingCoverageResult,
  CoverageRule,
} from "./types.mts";
import { matchRule } from "./rules.mts";

function matchesAny(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => minimatch(path, pattern, { dot: true }));
}

export function normalizeCoveragePath(value: string): string {
  return value
    .replace(/^file:\/\//, "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/^\.\//, "");
}

export function coverageDisposition(value: string, scope: CoverageScope): CoverageDisposition {
  const path = normalizeCoveragePath(value);
  if (!matchesAny(path, scope.include) || matchesAny(path, scope.ignored ?? [])) return "ignored";
  return matchesAny(path, scope.supplemental ?? []) ? "supplemental" : "aggregate";
}

function loaderFor(path: string): Loader | null {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".jsx")) return "jsx";
  if (/\.(?:ts|mts|cts)$/.test(path)) return "ts";
  if (/\.(?:js|mjs|cjs)$/.test(path)) return "js";
  return null;
}

/** Returns source lines that emit JavaScript, excluding import/export continuation lines. */
export function executableLineNumbers(source: string, path: string): Set<number> {
  const language = loaderFor(path);
  if (language === null) return new Set();
  const result = transformSync(source, {
    format: "esm",
    legalComments: "none",
    loader: language,
    sourcefile: normalizeCoveragePath(path),
    sourcemap: "external",
  });
  const lines = new Set<number>();
  eachMapping(new TraceMap(result.map), (mapping) => {
    lines.add(Number(mapping.originalLine));
  });
  lines.delete(0);
  let declarationStart = 0;
  for (const [index, text] of source.split("\n").entries()) {
    const trimmed = text.trimStart();
    if (
      declarationStart === 0 &&
      (/^import(?!\s*\()/.test(trimmed) || /^export\s*(?:type\s*)?(?:\{|\*)/.test(trimmed))
    )
      declarationStart = index + 1;
    if (declarationStart !== 0 && index + 1 > declarationStart) lines.delete(index + 1);
    if (declarationStart !== 0 && /(?:;|\sfrom\s+["'][^"']+["']\s*;?)\s*$/.test(trimmed))
      declarationStart = 0;
  }
  return lines;
}

export function findMissingCoverage(
  diff: DiffLines,
  lcov: LcovData,
  rules: CoverageRule[],
  scope: CoverageScope,
  readSource: (path: string) => string = (path) => readFileSync(path, "utf8"),
): MissingCoverageResult[] {
  const missing: MissingCoverageResult[] = [];
  for (const [file, changedLines] of diff) {
    if (lcov.has(file) || coverageDisposition(file, scope) === "ignored") continue;
    const rule = matchRule(file, rules);
    if (rule === null || rule.patch_coverage_min <= 0) continue;
    let executable: Set<number>;
    try {
      executable = executableLineNumbers(readSource(file), file);
    } catch (error) {
      throw new Error(`failed to analyze coverage scope for ${file}: ${String(error)}`);
    }
    const lines = [...changedLines].filter((line) => executable.has(line)).sort((a, b) => a - b);
    if (lines.length > 0) missing.push({ file, lines, rule: rule.paths });
  }
  return missing;
}

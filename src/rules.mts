/* c8 ignore next */
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import yaml from "js-yaml";
import type { CoverageRule, CoverageRules, DiffLines } from "./types.mts";

function validateDropRuleFields(rule: Partial<CoverageRule>, i: number, rulesPath: string): void {
  const noDrop = rule.no_coverage_drop;
  if (noDrop !== undefined && typeof noDrop !== "boolean") {
    throw new Error(`${rulesPath}: rule[${i}].no_coverage_drop must be a boolean`);
  }
  const maxDrop = rule.max_coverage_drop;
  if (maxDrop !== undefined) {
    if (!Number.isFinite(maxDrop) || maxDrop < 0) {
      throw new Error(`${rulesPath}: rule[${i}].max_coverage_drop must be a non-negative number`);
    }
    if (!noDrop) {
      throw new Error(`${rulesPath}: rule[${i}].max_coverage_drop requires no_coverage_drop: true`);
    }
  }
}

export function loadRules(rulesPath: string): CoverageRule[] {
  const text = readFileSync(rulesPath, "utf8");
  const parsed = yaml.load(text) as CoverageRules;
  if (!Array.isArray(parsed?.rules)) {
    throw new Error(`${rulesPath}: expected a 'rules' array`);
  }
  for (let i = 0; i < parsed.rules.length; i++) {
    const rule = parsed.rules[i] as Partial<CoverageRule>;
    if (typeof rule?.paths !== "string") {
      throw new Error(`${rulesPath}: rule[${i}].paths must be a string`);
    }
    const min = rule.patch_coverage_min;
    if (!Number.isFinite(min) || (min as number) < 0 || (min as number) > 100) {
      throw new Error(
        `${rulesPath}: rule[${i}].patch_coverage_min must be a number between 0 and 100`,
      );
    }
    validateDropRuleFields(rule, i, rulesPath);
  }
  return parsed.rules;
}

/** Returns the first matching rule for a repo-root-relative file path, or null. */
export function matchRule(file: string, rules: CoverageRule[]): CoverageRule | null {
  for (const rule of rules) {
    if (matchesGlob(file, rule.paths)) return rule;
  }
  return null;
}

/**
 * Returns the set of rules that have at least one changed file in the diff.
 * Used by `--drop-only-changed-areas` to scope the coverage-drop gate.
 */
export function buildChangedRules(diff: DiffLines, rules: CoverageRule[]): Set<CoverageRule> {
  return new Set(
    [...diff.keys()].map((f) => matchRule(f, rules)).filter((r): r is CoverageRule => r !== null),
  );
}

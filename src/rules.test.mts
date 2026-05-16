import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadRules, matchRule } from "./rules.mts";
import type { CoverageRule } from "./types.mts";

const rules: CoverageRule[] = [
  { paths: "cloudflare-worker/**", patch_coverage_min: 100 },
  { paths: "lambdas/**", patch_coverage_min: 100 },
  { paths: "web/lib/api/**", patch_coverage_min: 100 },
  { paths: "backend/**", patch_coverage_min: 90 },
  { paths: "web/**", patch_coverage_min: 5 },
];

describe("matchRule", () => {
  it("matches cloudflare-worker files", () => {
    expect(matchRule("cloudflare-worker/src/index.mts", rules)?.patch_coverage_min).toBe(100);
  });

  it("matches the more-specific web/lib/api/** before web/**", () => {
    expect(matchRule("web/lib/api/client.mts", rules)?.patch_coverage_min).toBe(100);
  });

  it("matches web/** for non-api web files", () => {
    expect(matchRule("web/components/Foo.tsx", rules)?.patch_coverage_min).toBe(5);
  });

  it("matches backend/**", () => {
    expect(matchRule("backend/services/foo.mts", rules)?.patch_coverage_min).toBe(90);
  });

  it("returns null for unmatched paths", () => {
    expect(matchRule("ci/ci-local.mts", rules)).toBeNull();
    expect(matchRule("docs/README.md", rules)).toBeNull();
  });

  it("matches lambdas/**", () => {
    expect(matchRule("lambdas/handler.mts", rules)?.patch_coverage_min).toBe(100);
  });
});

describe("loadRules", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coverage-check-rules-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(name: string, content: string) {
    const path = join(tmpDir, name);
    writeFileSync(path, content, "utf8");
    return path;
  }

  it("loads a valid rules file", () => {
    const path = write("rules.yml", "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n");
    expect(loadRules(path)).toEqual([{ paths: "backend/**", patch_coverage_min: 90 }]);
  });

  it("throws when rules is not an array", () => {
    const path = write("rules.yml", "rules: not-an-array\n");
    expect(() => loadRules(path)).toThrow("expected a 'rules' array");
  });

  it("throws when a rule paths field is missing", () => {
    const path = write("rules.yml", "rules:\n  - patch_coverage_min: 90\n");
    expect(() => loadRules(path)).toThrow("rule[0].paths must be a string");
  });

  it("throws when patch_coverage_min is out of range", () => {
    const path = write("rules.yml", "rules:\n  - paths: backend/**\n    patch_coverage_min: 150\n");
    expect(() => loadRules(path)).toThrow(
      "rule[0].patch_coverage_min must be a number between 0 and 100",
    );
  });

  it("throws when patch_coverage_min is not a number", () => {
    const path = write(
      "rules.yml",
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 'high'\n",
    );
    expect(() => loadRules(path)).toThrow(
      "rule[0].patch_coverage_min must be a number between 0 and 100",
    );
  });

  it("throws when patch_coverage_min is negative", () => {
    const path = write("rules.yml", "rules:\n  - paths: backend/**\n    patch_coverage_min: -1\n");
    expect(() => loadRules(path)).toThrow(
      "rule[0].patch_coverage_min must be a number between 0 and 100",
    );
  });
});

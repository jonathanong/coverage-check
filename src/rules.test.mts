import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCoverageConfig, loadRules, matchRule, zeroThresholdGlobs } from "./rules.mts";
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

  it("loads and validates a coverage scope", () => {
    const path = write(
      "rules.yml",
      "scope:\n  version: 1\n  analyzer: javascript\n  include: ['src/**']\n  supplemental: ['src/types.ts']\n  ignored: ['src/generated/**']\nrules:\n  - paths: src/**\n    patch_coverage_min: 99\n",
    );
    expect(loadCoverageConfig(path).scope).toEqual({
      version: 1,
      analyzer: "javascript",
      include: ["src/**"],
      supplemental: ["src/types.ts"],
      ignored: ["src/generated/**"],
    });
  });

  it("rejects an unsupported scope version", () => {
    const path = write(
      "rules.yml",
      "scope:\n  version: 2\n  analyzer: javascript\n  include: ['src/**']\nrules: []\n",
    );
    expect(() => loadCoverageConfig(path)).toThrow("scope.version must be 1");
  });

  it.each([
    ["scope: null\nrules: []\n", "scope must be an object"],
    [
      "scope:\n  version: 1\n  analyzer: ruby\n  include: []\nrules: []\n",
      "scope.analyzer must be 'javascript'",
    ],
    [
      "scope:\n  version: 1\n  analyzer: javascript\n  include: nope\nrules: []\n",
      "scope.include must be an array of strings",
    ],
    [
      "scope:\n  version: 1\n  analyzer: javascript\n  include: []\nrules: []\n",
      "scope.include must contain at least one pattern",
    ],
    [
      "scope:\n  version: 1\n  analyzer: javascript\n  include: ['src/**']\n  ignored: [1]\nrules: []\n",
      "scope.ignored must be an array of strings",
    ],
    [
      "scope:\n  version: 1\n  analyzer: javascript\n  include: ['src/**']\n  supplemental: nope\nrules: []\n",
      "scope.supplemental must be an array of strings",
    ],
  ])("rejects an invalid scope: %s", (yaml, message) => {
    const path = write("rules.yml", yaml);
    expect(() => loadCoverageConfig(path)).toThrow(message);
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

  it("accepts no_coverage_drop: true as valid", () => {
    const path = write(
      "rules.yml",
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    no_coverage_drop: true\n",
    );
    expect(loadRules(path)).toEqual([
      { paths: "backend/**", patch_coverage_min: 90, no_coverage_drop: true },
    ]);
  });

  it("accepts no_coverage_drop: true with max_coverage_drop as valid", () => {
    const path = write(
      "rules.yml",
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    no_coverage_drop: true\n    max_coverage_drop: 0.5\n",
    );
    expect(loadRules(path)).toEqual([
      {
        paths: "backend/**",
        patch_coverage_min: 90,
        no_coverage_drop: true,
        max_coverage_drop: 0.5,
      },
    ]);
  });

  it("throws when no_coverage_drop is not a boolean", () => {
    const path = write(
      "rules.yml",
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    no_coverage_drop: 'yes'\n",
    );
    expect(() => loadRules(path)).toThrow("must be a boolean");
  });

  it("throws when max_coverage_drop is negative", () => {
    const path = write(
      "rules.yml",
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    no_coverage_drop: true\n    max_coverage_drop: -1\n",
    );
    expect(() => loadRules(path)).toThrow("must be a non-negative number");
  });

  it("throws when max_coverage_drop is used without no_coverage_drop", () => {
    const path = write(
      "rules.yml",
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    max_coverage_drop: 0.5\n",
    );
    expect(() => loadRules(path)).toThrow("requires no_coverage_drop");
  });
});

describe("zeroThresholdGlobs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coverage-check-rules-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns globs with a zero patch coverage threshold", () => {
    const path = join(tmpDir, "rules.yml");
    writeFileSync(
      path,
      "rules:\n  - paths: generated/**\n    patch_coverage_min: 0\n  - paths: backend/**\n    patch_coverage_min: 90\n",
    );

    expect(zeroThresholdGlobs(path)).toEqual(["generated/**"]);
  });
});

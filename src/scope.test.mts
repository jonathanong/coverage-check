import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  coverageDisposition,
  executableLineNumbers,
  findMissingCoverage,
  normalizeCoveragePath,
} from "./scope.mts";

const scope = {
  version: 1 as const,
  analyzer: "javascript" as const,
  include: ["src/**/*.{ts,tsx}"],
  ignored: ["src/generated/**"],
  supplemental: ["src/types.ts"],
};

describe("coverage scope", () => {
  it("applies ignored, supplemental, aggregate, and outside-scope dispositions", () => {
    expect(coverageDisposition("src/generated/a.ts", scope)).toBe("ignored");
    expect(coverageDisposition("src/types.ts", scope)).toBe("supplemental");
    expect(coverageDisposition("src/a.ts", scope)).toBe("aggregate");
    expect(coverageDisposition("docs/a.ts", scope)).toBe("ignored");
  });

  it("identifies emitted lines but omits types, comments, and import continuations", () => {
    const lines = executableLineNumbers(
      `import defaultThing, {\n  thing,\n} from "./thing.ts";\n// comment\ntype Shape = { x: number };\nexport const value = thing ?? defaultThing;\n`,
      "src/a.ts",
    );
    expect([...lines]).toContain(6);
    expect([...lines]).not.toContain(2);
    expect([...lines]).not.toContain(4);
    expect([...lines]).not.toContain(5);
  });

  it("normalizes file URLs, Windows separators, and leading paths", () => {
    expect(normalizeCoveragePath("file:///./src\\a.ts")).toBe("src/a.ts");
  });

  it.each([
    ["src/a.tsx", "export const value = <div />;"],
    ["src/a.jsx", "export const value = <div />;"],
    ["src/a.mts", "export const value = 1;"],
    ["src/a.js", "export const value = 1;"],
  ])("analyzes supported JavaScript-family file %s", (path, source) => {
    expect(executableLineNumbers(source, path)).toContain(1);
  });

  it("returns no executable lines for unsupported files", () => {
    expect(executableLineNumbers("value", "src/a.css")).toEqual(new Set());
  });

  it("handles export continuations and dynamic imports", () => {
    const lines = executableLineNumbers(
      `export {\n  value,\n} from "./value.ts";\nconst loaded = import("./lazy.ts");\n`,
      "src/a.ts",
    );
    expect(lines).not.toContain(2);
    expect(lines).toContain(4);
  });

  it("finds only positive-rule missing executable coverage", () => {
    const diff = new Map([
      ["src/covered.ts", new Set([1])],
      ["src/ignored.ts", new Set([1])],
      ["src/unmatched.ts", new Set([1])],
      ["src/zero.ts", new Set([1])],
      ["src/missing.ts", new Set([1])],
      ["src/unreadable.ts", new Set([1])],
    ]);
    const lcov = new Map([["src/covered.ts", new Map([[1, 1]])]]);
    const rules = [
      { paths: "src/zero.ts", patch_coverage_min: 0 },
      { paths: "src/missing.ts", patch_coverage_min: 99 },
      { paths: "src/unreadable.ts", patch_coverage_min: 99 },
    ];
    expect(() =>
      findMissingCoverage(diff, lcov, rules, scope, (path) => {
        if (path.endsWith("unreadable.ts")) throw new Error("missing");
        return "export const value = 1;";
      }),
    ).toThrow("failed to analyze coverage scope for src/unreadable.ts");
  });

  it("reads source from disk by default", () => {
    const directory = mkdtempSync(join(tmpdir(), "coverage-check-scope-"));
    const file = join(directory, "missing.ts");
    writeFileSync(file, "export const value = 1;\n");
    expect(
      findMissingCoverage(
        new Map([[file, new Set([1])]]),
        new Map(),
        [{ paths: "**/*.ts", patch_coverage_min: 99 }],
        { version: 1, analyzer: "javascript", include: ["**/*.ts"] },
      ),
    ).toEqual([{ file, lines: [1], rule: "**/*.ts" }]);
    rmSync(directory, { recursive: true, force: true });
  });
});

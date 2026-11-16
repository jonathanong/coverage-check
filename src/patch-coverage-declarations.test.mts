import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "acorn";
import { convert } from "ast-v8-to-istanbul";
import libCoverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { describe, expect, it } from "vitest";
import { computePatchCoverage } from "./patch-coverage.mts";
import { parseLcov } from "./lcov-parser.mts";
import { mergeLcov } from "./lcov-merge.mts";
import { projectPatchLcov } from "./patch-contribution.mts";

const file = "src/actions.tsx";
const rules = [{ paths: "src/**", patch_coverage_min: 100 }];
const scope = { version: 1 as const, analyzer: "javascript" as const, include: ["src/**"] };
const source = `export function Actions() {
  return <Controls
    approve={() =>
      confirm()
    }
    reject={() =>
      reject()
    }
  />;
}
`;

function check(text: string, contents = source, lines = [3, 4, 6, 7]) {
  return computePatchCoverage(
    new Map([[file, new Set(lines)]]),
    parseLcov(text),
    rules,
    scope,
    () => contents,
  );
}

/** Real statement/branch maps: the return owns one DA counter; its alternatives own BRDA only. */
async function statementOnlyLcov(contents: string): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "coverage-check-arrow-statements-"));
  try {
    const coverage = await convert({
      ast: parse(contents, { ecmaVersion: "latest", sourceType: "module", locations: true }),
      code: contents,
      coverage: {
        url: pathToFileURL(resolve(file)).href,
        functions: [
          {
            functionName: "",
            isBlockCoverage: true,
            ranges: [{ startOffset: 0, endOffset: contents.length, count: 2 }],
          },
        ],
      },
    });
    reports.create("lcovonly", { projectRoot: process.cwd() }).execute(
      libReport.createContext({
        dir: directory,
        coverageMap: libCoverage.createCoverageMap(coverage),
      }),
    );
    return readFileSync(join(directory, "lcov.info"), "utf8");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("executable arrow declaration patch coverage", () => {
  it("does not charge browser-only declaration counters when another provider covers both bodies", () => {
    const browser = parseLcov(
      `SF:${file}\nFN:3,approve\nFN:6,reject\nFNDA:0,approve\nFNDA:0,reject\nDA:3,0\nDA:6,0\nend_of_record\n`,
    );
    const exercised = parseLcov(
      `SF:${file}\nFN:3,approve\nFN:6,reject\nFNDA:2,approve\nFNDA:2,reject\nDA:4,2\nDA:7,2\nend_of_record\n`,
    );
    const result = computePatchCoverage(
      new Map([[file, new Set([3, 4, 6, 7])]]),
      mergeLcov([browser, exercised]),
      rules,
      scope,
      () => source,
    );
    expect(result.buckets[0]).toMatchObject({ coverable: 2, hit: 2, passed: true });
    expect(result.missingCoverage).toEqual([]);
  });

  it("excludes wrapper-only lines consistently when their provider counters are positive", () => {
    expect(
      check(`SF:${file}\nDA:3,2\nDA:4,2\nDA:6,2\nDA:7,2\nend_of_record\n`).buckets[0],
    ).toMatchObject({ coverable: 2, hit: 2, passed: true });
  });

  it("does not let positive wrapper counters cover an uninvoked body", () => {
    expect(
      check(`SF:${file}\nDA:3,2\nDA:4,0\nDA:6,2\nDA:7,2\nend_of_record\n`).buckets[0],
    ).toMatchObject({ coverable: 2, hit: 1, passed: false });
  });

  it("still fails for an uninvoked callback body", () => {
    expect(
      check(`SF:${file}\nDA:3,0\nDA:4,0\nDA:6,0\nDA:7,2\nend_of_record\n`).buckets[0],
    ).toMatchObject({
      coverable: 2,
      hit: 1,
      passed: false,
      files: [{ file, coverable: 2, hit: 1, uncoveredLines: [4], rule: "src/**" }],
    });
  });

  it("keeps a same-line callback body executable even with a positive function counter", () => {
    const text = `SF:${file}\nFN:1,callback\nFNDA:2,callback\nDA:1,0\nend_of_record\n`;
    expect(check(text, "export const callback = () => missing();", [1]).buckets[0]).toMatchObject({
      coverable: 1,
      hit: 0,
      passed: false,
    });
  });

  it("keeps other executable initializers on the declaration line", () => {
    const contents = "const value = sideEffect(); const callback = () =>\n  missing();\n";
    expect(
      check(`SF:${file}\nDA:1,0\nDA:2,1\nend_of_record\n`, contents, [1, 2]).buckets[0],
    ).toMatchObject({ coverable: 2, hit: 1, passed: false });
  });

  it("fails closed when the callback bodies have no coverage artifact", () => {
    expect(check("").missingCoverage).toEqual([{ file, lines: [4, 7], rule: "src/**" }]);
  });
  it.each([
    "export const view = <Controls enabled={check()} approve={() =>\n  confirm()}/>;",
    "export const view = <Controls {...props} approve={() =>\n  confirm()}/>;",
    "export const handlers = { [nextKey()]: () =>\n  confirm() };",
    "export const callback = (value = fallback()) =>\n  confirm(value);",
    "export const callback = ({value = fallback()}) =>\n  confirm(value);",
    "export const callback = condition ? () =>\n  confirm() : other;",
  ])("retains executable expressions sharing the wrapper line: %s", (contents) => {
    expect(
      check(`SF:${file}\nDA:1,0\nDA:2,1\nend_of_record\n`, contents, [1, 2]).buckets[0],
    ).toMatchObject({ coverable: 2, hit: 1, passed: false });
  });

  it.each([
    () => {
      throw new Error("source unavailable");
    },
    () => "export const broken = (",
  ])("retains genuine DA counters when source cannot prove a declaration", (readSource) => {
    const result = computePatchCoverage(
      new Map([[file, new Set([1])]]),
      parseLcov(`SF:${file}\nDA:1,0\nend_of_record\n`),
      rules,
      scope,
      readSource,
    );
    expect(result.buckets[0]).toMatchObject({ coverable: 1, hit: 0, passed: false });
  });
  it("retains CommonJS assignment counters when esbuild adds unmapped module-wrapper operations", () => {
    const result = check(
      `SF:${file}\nDA:1,0\nDA:2,2\nend_of_record\n`,
      "module.exports = () =>\n  run();",
      [1, 2],
    );
    expect(result.buckets[0]).toMatchObject({ coverable: 2, hit: 1, passed: false });
    expect(result.missingCoverage).toEqual([]);
  });

  it("preserves sparse array initializers sharing an arrow declaration line", () => {
    const contents = "const holes = [,,value]; export const callback = () =>\n  run();";
    expect(
      check(`SF:${file}\nDA:1,0\nDA:2,2\nend_of_record\n`, contents, [1, 2]).buckets[0],
    ).toMatchObject({ coverable: 2, hit: 1, passed: false });
  });

  it("does not require an unchanged arrow body when only its declaration changes", () => {
    const result = check(`SF:${file}\nDA:3,0\nend_of_record\n`, source, [3]);
    expect(result.buckets).toEqual([]);
    expect(result.missingCoverage).toEqual([]);
  });

  it("retains a changed uncovered body without charging its unchanged declaration", () => {
    const result = check(`SF:${file}\nDA:3,0\nDA:4,0\nend_of_record\n`, source, [4]);
    expect(result.buckets[0]).toMatchObject({ coverable: 1, hit: 0, passed: false });
    expect(result.missingCoverage).toEqual([]);
  });

  it("does not infer missing instrumentation from an untracked declaration", () => {
    const result = check(`SF:${file}\nDA:4,2\nend_of_record\n`, source, [3, 4]);
    expect(result.buckets[0]).toMatchObject({ coverable: 1, hit: 1, passed: true });
    expect(result.missingCoverage).toEqual([]);
  });
  it("accepts statement-only body instrumentation without requiring DA on conditional alternatives", async () => {
    const contents =
      "export const choose = (condition) => {\n  return condition\n    ? foo()\n    : bar();\n};\n";
    const lcov = await statementOnlyLcov(contents);
    expect([...parseLcov(lcov).get(file)!.keys()]).toEqual([1, 2]);
    expect(lcov).toContain("BRDA:2,0,0,2");
    expect(lcov).toContain("BRDA:2,0,1,2");
    const result = check(lcov, contents, [1, 2, 3, 4, 5]);
    expect(result.buckets[0]).toMatchObject({ coverable: 1, hit: 1, passed: true });
    expect(result.missingCoverage).toEqual([]);
    // A genuine zero statement remains uncovered even with positive function/branch counters.
    const unhit = check(lcov.replace("DA:2,2", "DA:2,0"), contents, [1, 2, 3, 4, 5]);
    expect(unhit.buckets[0]).toMatchObject({ coverable: 1, hit: 0, passed: false });
    expect(unhit.missingCoverage).toEqual([]);
  });

  it("recognizes an unchanged body statement anchor for changed multiline expressions", () => {
    const contents =
      "export const choose = condition => {\n  return condition\n    ? foo()\n    : bar();\n};\n";
    const result = check(
      `SF:${file}\nDA:1,0\nDA:2,2\nBRDA:2,0,0,2\nBRDA:2,0,1,2\nend_of_record\n`,
      contents,
      [1, 3, 4],
    );
    expect(result.buckets).toEqual([]);
    expect(result.missingCoverage).toEqual([]);
  });
  it("does not invent superclass evaluation for a bare class declaration", () => {
    const contents = "export const create = () => {\n  class Bare {}\n};\n";
    const result = check(`SF:${file}\nDA:1,0\nend_of_record\n`, contents, [1, 2, 3]);
    expect(result.buckets).toEqual([]);
    expect(result.missingCoverage).toEqual([]);
  });
  it("accepts a multiline static initializer's value counter without requiring a separate field-key counter", async () => {
    const contents =
      "export const create = () => {\n  class C {\n    static value =\n      1;\n  }\n};\n";
    const lcov = await statementOnlyLcov(contents);
    expect([...parseLcov(lcov).get(file)!.keys()]).toEqual([1, 4]);
    const result = check(lcov, contents, [1, 2, 3, 4, 5, 6]);
    expect(result.buckets[0]).toMatchObject({ coverable: 1, hit: 1, passed: true });
    expect(result.missingCoverage).toEqual([]);
  });

  it("retains original counters when auto-accessor syntax is unsupported by the existing parser", () => {
    const contents = "export const create = () => {\n  class C { accessor value = 1; }\n};\n";
    const result = check(`SF:${file}\nDA:1,0\nend_of_record\n`, contents, [1, 2, 3]);
    expect(result.buckets[0]).toMatchObject({ coverable: 1, hit: 0, passed: false });
  });

  it("does not invent body operations for an empty static block", () => {
    const contents = "export const create = () => {\n  class C { static {} }\n};\n";
    const result = check(`SF:${file}\nDA:1,0\nend_of_record\n`, contents, [1, 2, 3]);
    expect(result.buckets).toEqual([]);
    expect(result.missingCoverage).toEqual([]);
  });
  it.each([
    "export const callback = (value =\n  42\n) => value;",
    "export const callback = (value =\n  fallback\n) => value;",
    "export const callback = ({value =\n  42\n} = {}) => value;",
    "export const callback = ([value =\n  42\n] = []) => value;",
    "export const callback = (value = [\n  42\n]) => value;",
    "export const callback = (value = [[\n  fallback\n]]) => value;",
    "export const callback = (value = pick(\n  fallback\n)) => value;",
    "export const callback = ({\n  [key]: value\n} = {}) => value;",
    "export const callback = (value = { items: [\n  42\n] }) => value;",
    "export const callback = (value = collect(...\n  defaults\n)) => value;",
  ])("retains multiline default initializer counters: %s", (contents) => {
    const result = check(`SF:${file}\nDA:2,0\nDA:3,1\nend_of_record\n`, contents, [1, 2, 3]);
    expect(result.buckets[0]).toMatchObject({ coverable: 2, hit: 1, passed: false });
    expect(result.missingCoverage).toEqual([]);
  });

  it.each(["// changed comment", "type Options = { value: number };"])(
    "uses emitted-line scope analysis for unsupported optional-parser syntax after %s",
    (prefix) => {
      const contents = `${prefix}\nexport class Store { accessor value = 1; }\n`;
      expect(check("", contents, [1]).missingCoverage).toEqual([]);
      expect(check("", contents, [2]).missingCoverage).toEqual([
        { file, lines: [2], rule: "src/**" },
      ]);
    },
  );

  it("still rejects invalid source in fail-closed missing-artifact analysis", () => {
    expect(() => check("", "export const broken = (", [1])).toThrow(
      "failed to analyze coverage scope",
    );
  });
  it("keeps full and projected LCOV equivalent when an unchanged statement anchor owns changed expressions", async () => {
    const contents =
      "export const choose = condition => {\n  return condition\n    ? foo()\n    : bar();\n};\n";
    const full = await statementOnlyLcov(contents);
    const changed = [1, 3, 4];
    const sparse = projectPatchLcov(full, new Map([[file, new Set(changed)]]));
    expect(parseLcov(full).get(file)?.has(2)).toBe(true);
    expect(parseLcov(sparse).get(file)?.has(2)).toBe(false);
    const fullResult = check(full, contents, changed);
    const sparseResult = check(sparse, contents, changed);
    expect(fullResult.missingCoverage).toEqual([]);
    expect(sparseResult).toEqual(fullResult);
  });

  it("preserves genuinely uncovered changed statement counters in full and projected LCOV", async () => {
    const contents =
      "export const choose = condition => {\n  return condition\n    ? foo()\n    : bar();\n};\n";
    const full = (await statementOnlyLcov(contents)).replace("DA:2,2", "DA:2,0");
    const changed = [1, 2, 3, 4];
    const sparse = projectPatchLcov(full, new Map([[file, new Set(changed)]]));
    const fullResult = check(full, contents, changed);
    expect(fullResult.buckets[0]).toMatchObject({ coverable: 1, hit: 0, passed: false });
    expect(check(sparse, contents, changed)).toEqual(fullResult);
  });
  it.each([
    "const value =\n  42; const callback = () =>\n    value;",
    "const value = collect(\n  fallback); const callback = () =>\n    value;",
    "const value = [\n  42]; const callback = () =>\n    value;",
    "const value = new Factory(\n  fallback); const callback = () =>\n    value;",
  ])("retains a multiline variable initializer sharing an arrow header: %s", (contents) => {
    expect(
      check(`SF:${file}\nDA:2,0\nDA:3,1\nend_of_record\n`, contents, [1, 2, 3]).buckets[0],
    ).toMatchObject({ coverable: 2, hit: 1, passed: false });
  });

  it("does not infer executable body counters omitted by a report's ignore handling", () => {
    const contents = "const callback = () => {\n  /* istanbul ignore next */\n  omitted();\n};\n";
    const result = check(`SF:${file}\nDA:1,0\nend_of_record\n`, contents, [1, 2, 3, 4]);
    expect(result.missingCoverage).toEqual([]);
    // No ignore-directive parser is introduced: a wholly absent file still fails closed.
    expect(check("", contents, [3]).missingCoverage).toEqual([
      { file, lines: [3], rule: "src/**" },
    ]);
  });
  it.each([
    "class C extends\n  Base {} const callback = () =>\n    run();",
    "class C { static value =\n  1; } const callback = () =>\n    run();",
    "class C {\n  static value; } const callback = () =>\n    run();",
    "class C {\n  [key]; } const callback = () =>\n    run();",
    "class C {\n  static [key] = 1; } const callback = () =>\n    run();",
    "class C {\n  [key]() {} } const callback = () =>\n    run();",
    "class C {\n  get [key]() {} } const callback = () =>\n    run();",
    "class C { static {\n  const value = 1; } } const callback = () =>\n    run();",
  ])("retains executable class operations sharing an arrow header: %s", (contents) => {
    const result = check(`SF:${file}\nDA:2,0\nDA:3,1\nend_of_record\n`, contents, [1, 2, 3]);
    expect(result.buckets[0]).toMatchObject({ coverable: 2, hit: 1, passed: false });
    expect(result.missingCoverage).toEqual([]);
  });
});

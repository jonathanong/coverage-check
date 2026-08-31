import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareCoverageSummaries } from "./coverage-summary-comparison.mts";
import { main, renderComparison } from "./commands/compare-summary.mts";

type Metric = { covered: number; total: number };
type Summary = Record<string, Record<string, Metric>>;

function summary(
  files: Record<string, Partial<Record<"lines" | "statements" | "functions" | "branches", Metric>>>,
): Summary {
  const entries = Object.fromEntries(
    Object.entries(files).map(([file, metrics]) => [
      file,
      Object.fromEntries(Object.entries(metrics).map(([name, value]) => [name, { ...value }])),
    ]),
  );
  const total = Object.fromEntries(
    ["lines", "statements", "functions", "branches"].map((metric) => [
      metric,
      Object.values(files).reduce(
        (result, file) => ({
          covered: result.covered + (file[metric as keyof typeof file]?.covered ?? 0),
          total: result.total + (file[metric as keyof typeof file]?.total ?? 0),
        }),
        { covered: 0, total: 0 },
      ),
    ]),
  );
  return { ...entries, total };
}

describe("compareCoverageSummaries", () => {
  it("compares retained production files and recomputes aggregate totals", () => {
    const base = summary({
      "/base/src/a.ts": {
        lines: { covered: 8, total: 10 },
        statements: { covered: 9, total: 10 },
        functions: { covered: 1, total: 2 },
        branches: { covered: 3, total: 4 },
      },
      "/base/src/tests/a.test.ts": {
        lines: { covered: 0, total: 10 },
        statements: { covered: 0, total: 10 },
        functions: { covered: 0, total: 10 },
        branches: { covered: 0, total: 10 },
      },
    });
    const head = summary({
      "/head/src/a.ts": {
        lines: { covered: 8, total: 10 },
        statements: { covered: 9, total: 10 },
        functions: { covered: 1, total: 2 },
        branches: { covered: 3, total: 4 },
      },
      "/head/src/new.ts": {
        lines: { covered: 0, total: 0 },
        statements: { covered: 0, total: 0 },
        functions: { covered: 0, total: 0 },
        branches: { covered: 0, total: 0 },
      },
    });

    expect(compareCoverageSummaries(base, head, "/base", "/head")).toEqual({
      passed: true,
      base: {
        lines: { covered: 8, total: 10, pct: 80 },
        statements: { covered: 9, total: 10, pct: 90 },
        functions: { covered: 1, total: 2, pct: 50 },
        branches: { covered: 3, total: 4, pct: 75 },
      },
      head: {
        lines: { covered: 8, total: 10, pct: 80 },
        statements: { covered: 9, total: 10, pct: 90 },
        functions: { covered: 1, total: 2, pct: 50 },
        branches: { covered: 3, total: 4, pct: 75 },
      },
      regressions: [],
    });
  });

  it("reports sorted missing baseline files and metric percentage decreases with counts", () => {
    const base = summary({
      "/base/src/z.ts": {
        lines: { covered: 2, total: 2 },
        statements: { covered: 2, total: 2 },
        functions: { covered: 2, total: 2 },
        branches: { covered: 2, total: 2 },
      },
      "/base/src/a.ts": {
        lines: { covered: 8, total: 10 },
        statements: { covered: 8, total: 10 },
        functions: { covered: 8, total: 10 },
        branches: { covered: 8, total: 10 },
      },
    });
    const head = summary({
      "/head/src/a.ts": {
        lines: { covered: 7, total: 10 },
        statements: { covered: 8, total: 10 },
        functions: { covered: 8, total: 10 },
        branches: { covered: 8, total: 10 },
      },
    });

    expect(compareCoverageSummaries(base, head, "/base", "/head")).toMatchObject({
      passed: false,
      regressions: [
        {
          kind: "decrease",
          file: "src/a.ts",
          metric: "lines",
          base: { covered: 8, total: 10, pct: 80 },
          head: { covered: 7, total: 10, pct: 70 },
        },
        { kind: "missing-file", file: "src/z.ts" },
        {
          kind: "aggregate-decrease",
          metric: "lines",
          base: { covered: 10, total: 12, pct: 83.33333333333334 },
          head: { covered: 7, total: 10, pct: 70 },
        },
        {
          kind: "aggregate-decrease",
          metric: "statements",
          base: { covered: 10, total: 12, pct: 83.33333333333334 },
          head: { covered: 8, total: 10, pct: 80 },
        },
        {
          kind: "aggregate-decrease",
          metric: "functions",
          base: { covered: 10, total: 12, pct: 83.33333333333334 },
          head: { covered: 8, total: 10, pct: 80 },
        },
        {
          kind: "aggregate-decrease",
          metric: "branches",
          base: { covered: 10, total: 12, pct: 83.33333333333334 },
          head: { covered: 8, total: 10, pct: 80 },
        },
      ],
    });
  });

  it("reports aggregate decreases caused by a head-only production source", () => {
    const base = summary({
      "/base/src/a.ts": {
        lines: { covered: 10, total: 10 },
        statements: { covered: 10, total: 10 },
        functions: { covered: 10, total: 10 },
        branches: { covered: 10, total: 10 },
      },
    });
    const head = summary({
      "/head/src/a.ts": {
        lines: { covered: 10, total: 10 },
        statements: { covered: 10, total: 10 },
        functions: { covered: 10, total: 10 },
        branches: { covered: 10, total: 10 },
      },
      "/head/src/new.ts": {
        lines: { covered: 0, total: 10 },
        statements: { covered: 0, total: 10 },
        functions: { covered: 0, total: 10 },
        branches: { covered: 0, total: 10 },
      },
    });

    expect(compareCoverageSummaries(base, head, "/base", "/head").regressions).toEqual([
      {
        kind: "aggregate-decrease",
        metric: "lines",
        base: { covered: 10, total: 10, pct: 100 },
        head: { covered: 10, total: 20, pct: 50 },
      },
      {
        kind: "aggregate-decrease",
        metric: "statements",
        base: { covered: 10, total: 10, pct: 100 },
        head: { covered: 10, total: 20, pct: 50 },
      },
      {
        kind: "aggregate-decrease",
        metric: "functions",
        base: { covered: 10, total: 10, pct: 100 },
        head: { covered: 10, total: 20, pct: 50 },
      },
      {
        kind: "aggregate-decrease",
        metric: "branches",
        base: { covered: 10, total: 10, pct: 100 },
        head: { covered: 10, total: 20, pct: 50 },
      },
    ]);
  });

  it("checks every Istanbul metric for per-file decreases", () => {
    const base = summary({
      "/base/src/a.ts": {
        lines: { covered: 8, total: 10 },
        statements: { covered: 8, total: 10 },
        functions: { covered: 8, total: 10 },
        branches: { covered: 8, total: 10 },
      },
    });
    const head = summary({
      "/head/src/a.ts": {
        lines: { covered: 7, total: 10 },
        statements: { covered: 7, total: 10 },
        functions: { covered: 7, total: 10 },
        branches: { covered: 7, total: 10 },
      },
    });

    expect(
      compareCoverageSummaries(base, head, "/base", "/head")
        .regressions.filter((regression) => regression.kind === "decrease")
        .map((regression) => regression.metric),
    ).toEqual(["lines", "statements", "functions", "branches"]);
  });

  it("uses 100% for zero totals and rejects invalid or ambiguous source paths", () => {
    const empty = summary({
      "/base/src/a.ts": {
        lines: { covered: 0, total: 0 },
        statements: { covered: 0, total: 0 },
        functions: { covered: 0, total: 0 },
        branches: { covered: 0, total: 0 },
      },
    });
    expect(compareCoverageSummaries(empty, empty, "/base", "/base").base.lines.pct).toBe(100);
    expect(() =>
      compareCoverageSummaries(
        summary({ "/base/src/a.ts": { lines: { covered: 2, total: 1 } } }),
        empty,
        "/base",
        "/base",
      ),
    ).toThrow("covered must not exceed total");
    expect(() =>
      compareCoverageSummaries(
        summary({
          "/base/src/a.ts": {
            lines: { covered: 0, total: 0 },
            statements: { covered: 0, total: 0 },
            functions: { covered: 0, total: 0 },
            branches: { covered: 0, total: 0 },
          },
          "/base/src/../src/a.ts": {
            lines: { covered: 0, total: 0 },
            statements: { covered: 0, total: 0 },
            functions: { covered: 0, total: 0 },
            branches: { covered: 0, total: 0 },
          },
        }),
        empty,
        "/base",
        "/base",
      ),
    ).toThrow("duplicate normalized source");
    expect(() => compareCoverageSummaries(empty, empty, "", "/base")).toThrow(
      "root must not be empty",
    );
    expect(() =>
      compareCoverageSummaries(
        summary({ "/outside/a.ts": { lines: { covered: 0, total: 0 } } }),
        empty,
        "/base",
        "/base",
      ),
    ).toThrow("outside root");
    expect(() =>
      compareCoverageSummaries(
        summary({ "D:\\outside\\a.ts": { lines: { covered: 0, total: 0 } } }),
        empty,
        "C:\\repository",
        "/base",
      ),
    ).toThrow("outside root");
  });

  it("excludes every supported test-source naming convention", () => {
    const metric = {
      lines: { covered: 0, total: 10 },
      statements: { covered: 0, total: 10 },
      functions: { covered: 0, total: 10 },
      branches: { covered: 0, total: 10 },
    };
    const excluded = [
      "src/__tests__/a.ts",
      "src/test/a.ts",
      "src/tests/a.ts",
      "src/a.test.js",
      "src/a.spec.jsx",
      "src/a.stories.tsx",
      "src/a.test.mjs",
      "src/a.spec.cjs",
      "src/a.stories.mts",
      "src/a.test.cts",
    ];
    const base = summary({
      "/base/src/a.ts": metric,
      ...Object.fromEntries(excluded.map((file) => [`/base/${file}`, metric])),
    });
    const head = summary({ "/head/src/a.ts": metric });

    expect(compareCoverageSummaries(base, head, "/base", "/head")).toMatchObject({
      passed: true,
      regressions: [],
      base: { lines: { covered: 0, total: 10, pct: 0 } },
    });
  });

  it("orders source paths by Unicode code point", () => {
    const zero = {
      lines: { covered: 0, total: 0 },
      statements: { covered: 0, total: 0 },
      functions: { covered: 0, total: 0 },
      branches: { covered: 0, total: 0 },
    };
    const base = summary({
      "/base/src/a": zero,
      "/base/src/a/b.ts": zero,
      "/base/src/𐀀.ts": zero,
      "/base/src/z.ts": zero,
      "/base/src/é.ts": zero,
    });

    expect(compareCoverageSummaries(base, summary({}), "/base", "/head").regressions).toEqual([
      { kind: "missing-file", file: "src/a" },
      { kind: "missing-file", file: "src/a/b.ts" },
      { kind: "missing-file", file: "src/z.ts" },
      { kind: "missing-file", file: "src/é.ts" },
      { kind: "missing-file", file: "src/𐀀.ts" },
    ]);
  });

  it("validates the Istanbul total record even though aggregates are recomputed", () => {
    const valid = summary({});
    expect(() => compareCoverageSummaries(null as never, valid, "/base", "/head")).toThrow(
      "base summary must be an object",
    );
    expect(() => compareCoverageSummaries({}, valid, "/base", "/head")).toThrow(
      "base summary total is missing",
    );
    expect(() =>
      compareCoverageSummaries(
        { total: { lines: { covered: 1, total: 0 } } },
        valid,
        "/base",
        "/head",
      ),
    ).toThrow("base summary total.lines.covered must not exceed total");
    expect(() =>
      compareCoverageSummaries(
        { total: { lines: { covered: Number.NaN, total: 0 } } },
        valid,
        "/base",
        "/head",
      ),
    ).toThrow("must be a finite nonnegative integer");
    expect(() =>
      compareCoverageSummaries(
        { total: { lines: { covered: 0.5, total: 1 } } },
        valid,
        "/base",
        "/head",
      ),
    ).toThrow("must be a finite nonnegative integer");
  });

  it("normalizes Windows checkout paths with Windows semantics on every host", () => {
    const metric = {
      lines: { covered: 1, total: 1 },
      statements: { covered: 1, total: 1 },
      functions: { covered: 1, total: 1 },
      branches: { covered: 1, total: 1 },
    };
    expect(
      compareCoverageSummaries(
        summary({ "C:\\base\\src\\a.ts": metric }),
        summary({ "D:\\head\\src\\a.ts": metric }),
        "C:\\base",
        "D:\\head",
      ),
    ).toMatchObject({ passed: true, regressions: [] });
  });
});

describe("compare-summary command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coverage-summary-comparison-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes deterministic JSON and returns 1 for a regression", async () => {
    const baseRoot = join(tmpDir, "base");
    const headRoot = join(tmpDir, "head");
    mkdirSync(join(baseRoot, "src"), { recursive: true });
    mkdirSync(join(headRoot, "src"), { recursive: true });
    const basePath = join(tmpDir, "base.json");
    const headPath = join(tmpDir, "head.json");
    const jsonPath = join(tmpDir, "nested", "result.json");
    writeFileSync(
      basePath,
      JSON.stringify(
        summary({
          [join(baseRoot, "src", "a.ts")]: {
            lines: { covered: 8, total: 10 },
            statements: { covered: 8, total: 10 },
            functions: { covered: 8, total: 10 },
            branches: { covered: 8, total: 10 },
          },
        }),
      ),
    );
    writeFileSync(
      headPath,
      JSON.stringify(
        summary({
          [join(headRoot, "src", "a.ts")]: {
            lines: { covered: 7, total: 10 },
            statements: { covered: 8, total: 10 },
            functions: { covered: 8, total: 10 },
            branches: { covered: 8, total: 10 },
          },
        }),
      ),
    );

    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await expect(
        main([
          "--base-summary",
          basePath,
          "--head-summary",
          headPath,
          "--base-root",
          baseRoot,
          "--head-root",
          headRoot,
          "--json",
          jsonPath,
        ]),
      ).resolves.toBe(1);
      expect(output.mock.calls.map(([value]) => String(value)).join("")).toContain(
        "COVERAGE REGRESSION",
      );
    } finally {
      output.mockRestore();
    }
    expect(JSON.parse(readFileSync(jsonPath, "utf8"))).toMatchObject({ passed: false });
  });

  it("returns 2 for missing required command input", async () => {
    await expect(main([])).resolves.toBe(2);
    await expect(main(["--base-summary"])).resolves.toBe(2);
    await expect(main(["--unknown", "value"])).resolves.toBe(2);
    await expect(main(["--base-summary", "a", "--base-summary", "b"])).resolves.toBe(2);
    await expect(
      main([
        "--base-summary",
        join(tmpDir, "missing.json"),
        "--head-summary",
        join(tmpDir, "also-missing.json"),
        "--base-root",
        join(tmpDir, "base"),
        "--head-root",
        join(tmpDir, "head"),
      ]),
    ).resolves.toBe(2);
  });

  it("renders a missing baseline file", () => {
    const metric = {
      lines: { covered: 0, total: 0 },
      statements: { covered: 0, total: 0 },
      functions: { covered: 0, total: 0 },
      branches: { covered: 0, total: 0 },
    };
    const result = compareCoverageSummaries(
      summary({ "/base/src/a.ts": metric }),
      summary({}),
      "/base",
      "/head",
    );
    expect(renderComparison(result)).toContain("src/a.ts: missing from head summary");
  });

  it("returns 0 and writes the exact deterministic pass result", async () => {
    const basePath = join(tmpDir, "base.json");
    const headPath = join(tmpDir, "head.json");
    const jsonPath = join(tmpDir, "nested", "result.json");
    writeFileSync(basePath, JSON.stringify(summary({})));
    writeFileSync(headPath, JSON.stringify(summary({})));
    const expected = {
      passed: true,
      base: Object.fromEntries(
        ["lines", "statements", "functions", "branches"].map((metric) => [
          metric,
          { covered: 0, total: 0, pct: 100 },
        ]),
      ),
      head: Object.fromEntries(
        ["lines", "statements", "functions", "branches"].map((metric) => [
          metric,
          { covered: 0, total: 0, pct: 100 },
        ]),
      ),
      regressions: [],
    };

    const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await expect(
        main([
          "--base-summary",
          basePath,
          "--head-summary",
          headPath,
          "--base-root",
          join(tmpDir, "base"),
          "--head-root",
          join(tmpDir, "head"),
          "--json",
          jsonPath,
        ]),
      ).resolves.toBe(0);
      expect(output.mock.calls.map(([value]) => String(value)).join("")).toContain(
        "coverage summary comparison passed",
      );
    } finally {
      output.mockRestore();
    }
    expect(readFileSync(jsonPath, "utf8")).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });
});

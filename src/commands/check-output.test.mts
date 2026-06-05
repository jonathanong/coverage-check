import { describe, it, expect, vi, afterEach } from "vitest";
import { warnNonContributing, printDropOutput } from "./check-output.mts";
import type { DropResult, LcovData, DiffLines } from "../types.mts";

function makeLcov(files: Record<string, Record<number, number>>): LcovData {
  const lcov: LcovData = new Map();
  for (const [file, lines] of Object.entries(files)) {
    lcov.set(file, new Map(Object.entries(lines).map(([l, h]) => [Number(l), h])));
  }
  return lcov;
}

function makeDiff(files: Record<string, number[]>): DiffLines {
  const diff: DiffLines = new Map();
  for (const [file, lines] of Object.entries(files)) {
    diff.set(file, new Set(lines));
  }
  return diff;
}

describe("warnNonContributing", () => {
  it("does nothing when diff is empty", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      warnNonContributing([{ name: "suite-a", lcov: makeLcov({}) }], new Map());
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("does not warn when a suite contributes at least one line", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const lcov = makeLcov({ "backend/index.ts": { 1: 1 } });
      const diff = makeDiff({ "backend/index.ts": [1] });
      warnNonContributing([{ name: "backend", lcov }], diff);
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("warns when a suite contributes zero coverable lines to the patch", () => {
    const writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const lcov = makeLcov({ "web/app.ts": { 5: 1 } });
      // Diff is on a file not present in this suite's lcov
      const diff = makeDiff({ "backend/index.ts": [1] });
      warnNonContributing([{ name: "web", lcov }], diff);
      expect(writeSpy).toHaveBeenCalledOnce();
      expect(String(writeSpy.mock.calls[0]![0])).toContain("web");
    } finally {
      writeSpy.mockRestore();
    }
  });
});

describe("printDropOutput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing when drops array is empty", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printDropOutput([]);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("prints skipped section for baseline-unavailable drops", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const drops: DropResult[] = [
      {
        rule: "backend/**",
        currentPct: null,
        baselinePct: null,
        drop: null,
        maxDrop: 0,
        passed: true,
        skipped: true,
      },
    ];
    printDropOutput(drops);
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("coverage drop check skipped");
    expect(output).toContain("backend/**");
    expect(output).toContain("no baseline available");
  });

  it("prints passing section with formatted percentages", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const drops: DropResult[] = [
      {
        rule: "web/**",
        currentPct: 95.5,
        baselinePct: 95,
        drop: -0.5,
        maxDrop: 0,
        passed: true,
        skipped: false,
      },
    ];
    printDropOutput(drops);
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("web/**");
    expect(output).toContain("95.50%");
    expect(output).toContain("95.00%");
    expect(output).toContain("✓");
  });

  it("prints passing section with — when currentPct and baselinePct are null", () => {
    // This exercises the fmtPct null branch: passed drop with null pct values (total=0 in lcov)
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const drops: DropResult[] = [
      {
        rule: "backend/**",
        currentPct: null,
        baselinePct: null,
        drop: null,
        maxDrop: 0,
        passed: true,
        skipped: false,
      },
    ];
    printDropOutput(drops);
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("backend/**");
    expect(output).toContain("—");
    expect(output).toContain("✓");
  });

  it("prints failing section with regression info", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const drops: DropResult[] = [
      {
        rule: "backend/**",
        currentPct: 80,
        baselinePct: 95,
        drop: 15,
        maxDrop: 0,
        passed: false,
        skipped: false,
      },
    ];
    printDropOutput(drops);
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("COVERAGE REGRESSION");
    expect(output).toContain("backend/**");
    expect(output).toContain("80.00%");
    expect(output).toContain("95.00%");
    expect(output).toContain("15.00pp");
    expect(output).toContain("max allowed 0pp");
  });

  it("prints all three sections when drops are mixed", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const drops: DropResult[] = [
      {
        rule: "backend/**",
        currentPct: null,
        baselinePct: null,
        drop: null,
        maxDrop: 0,
        passed: true,
        skipped: true,
      },
      {
        rule: "web/**",
        currentPct: 90,
        baselinePct: 90,
        drop: 0,
        maxDrop: 0,
        passed: true,
        skipped: false,
      },
      {
        rule: "cloudflare-worker/**",
        currentPct: 85,
        baselinePct: 100,
        drop: 15,
        maxDrop: 0,
        passed: false,
        skipped: false,
      },
    ];
    printDropOutput(drops);
    const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(output).toContain("skipped");
    expect(output).toContain("web/**");
    expect(output).toContain("COVERAGE REGRESSION");
    expect(output).toContain("cloudflare-worker/**");
  });
});

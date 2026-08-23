import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { V8CoverageProvider } from "@vitest/coverage-v8/dist/provider.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import providerModule, { formatSupplementalLcov, isEmptyCoverageReport } from "./vitest.mts";

describe("Vitest provider helpers", () => {
  const originalConfig = process.env["COVERAGE_CHECK_CONFIG"];
  const originalOutput = process.env["COVERAGE_CHECK_SUPPLEMENTAL_LCOV"];

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalConfig === undefined) delete process.env["COVERAGE_CHECK_CONFIG"];
    else process.env["COVERAGE_CHECK_CONFIG"] = originalConfig;
    if (originalOutput === undefined) delete process.env["COVERAGE_CHECK_SUPPLEMENTAL_LCOV"];
    else process.env["COVERAGE_CHECK_SUPPLEMENTAL_LCOV"] = originalOutput;
  });

  it("recognizes placeholder coverage", () => {
    expect(isEmptyCoverageReport({ fnMap: { 0: { name: "(empty-report)" } } })).toBe(true);
    expect(isEmptyCoverageReport({ fnMap: { 0: { name: "run" } } })).toBe(false);
  });

  it("formats stable supplemental LCOV", () => {
    expect(
      formatSupplementalLcov([
        { path: "src/z.ts", hits: { "2": 0, "1": 2 } },
        { path: "src/a.ts", hits: { "1": 1 } },
      ]),
    ).toBe(
      "TN:\nSF:src/a.ts\nDA:1,1\nend_of_record\nTN:\nSF:src/z.ts\nDA:1,2\nDA:2,0\nend_of_record\n",
    );
  });

  it("formats an empty supplemental report", () => {
    expect(formatSupplementalLcov([])).toBe("");
  });

  it("writes genuine supplemental records and filters aggregate coverage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "coverage-check-vitest-"));
    const config = join(directory, "rules.yml");
    const output = join(directory, "nested", "lcov.info");
    writeFileSync(
      config,
      "scope:\n  version: 1\n  analyzer: javascript\n  include: ['src/**']\n  ignored: ['src/ignored.ts']\n  supplemental: ['src/supplemental.ts', 'src/placeholder.ts']\nrules: []\n",
    );
    process.env["COVERAGE_CHECK_CONFIG"] = config;
    process.env["COVERAGE_CHECK_SUPPLEMENTAL_LCOV"] = output;
    const root = process.cwd().replaceAll("\\", "/");
    const files = [
      `${root}/src/supplemental.ts`,
      `${root}/src/placeholder.ts`,
      `${root}/src/aggregate.ts`,
      `${root}/src/ignored.ts`,
    ];
    let retained: string[] = [];
    const coverageMap = {
      files: () => files,
      fileCoverageFor: (file: string) => ({
        data: {
          fnMap: { 0: { name: file.endsWith("placeholder.ts") ? "(empty-report)" : "run" } },
        },
        getLineCoverage: () => ({ "2": 0, "1": 1 }),
      }),
      filter: (predicate: (file: string) => boolean) => {
        retained = files.filter(predicate);
      },
    };
    vi.spyOn(V8CoverageProvider.prototype, "generateCoverage").mockResolvedValue(
      coverageMap as never,
    );
    const provider = await providerModule.getProvider();
    expect(await provider.generateCoverage({ allTestsRun: true })).toBe(coverageMap);
    expect(readFileSync(output, "utf8")).toContain("SF:src/supplemental.ts\nDA:1,1\nDA:2,0");
    expect(retained).toEqual([`${root}/src/aggregate.ts`]);
    rmSync(directory, { recursive: true, force: true });
  });

  it("requires an output path", async () => {
    delete process.env["COVERAGE_CHECK_SUPPLEMENTAL_LCOV"];
    vi.spyOn(V8CoverageProvider.prototype, "generateCoverage").mockResolvedValue({} as never);
    await expect(
      (await providerModule.getProvider()).generateCoverage({ allTestsRun: true }),
    ).rejects.toThrow("COVERAGE_CHECK_SUPPLEMENTAL_LCOV");
  });

  it("requires a scope block", async () => {
    const directory = mkdtempSync(join(tmpdir(), "coverage-check-vitest-"));
    const config = join(directory, "rules.yml");
    writeFileSync(config, "rules: []\n");
    process.env["COVERAGE_CHECK_CONFIG"] = config;
    process.env["COVERAGE_CHECK_SUPPLEMENTAL_LCOV"] = join(directory, "lcov.info");
    vi.spyOn(V8CoverageProvider.prototype, "generateCoverage").mockResolvedValue({} as never);
    await expect(
      (await providerModule.getProvider()).generateCoverage({ allTestsRun: true }),
    ).rejects.toThrow("scope block is required");
    rmSync(directory, { recursive: true, force: true });
  });
});

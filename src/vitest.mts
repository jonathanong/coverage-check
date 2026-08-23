import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import v8CoverageModule from "@vitest/coverage-v8";
import { V8CoverageProvider } from "@vitest/coverage-v8/dist/provider.js";
import { loadCoverageConfig } from "./rules.mts";
import { coverageDisposition, normalizeCoveragePath } from "./scope.mts";

export type SupplementalLineCoverage = { path: string; hits: Record<string, number> };
type CoverageData = { fnMap: Record<string, { name: string }> };

export function isEmptyCoverageReport(data: CoverageData): boolean {
  return Object.values(data.fnMap).some(({ name }) => name === "(empty-report)");
}

export function formatSupplementalLcov(files: SupplementalLineCoverage[]): string {
  const records = files
    .toSorted((a, b) => a.path.localeCompare(b.path))
    .map(({ hits, path }) =>
      [
        "TN:",
        `SF:${normalizeCoveragePath(path)}`,
        ...Object.entries(hits)
          .map(([line, count]) => [Number(line), count] as const)
          .toSorted(([a], [b]) => a - b)
          .map(([line, count]) => `DA:${line},${count}`),
        "end_of_record",
      ].join("\n"),
    );
  return records.length === 0 ? "" : `${records.join("\n")}\n`;
}

export class ScopedV8CoverageProvider extends V8CoverageProvider {
  override async generateCoverage(context: { allTestsRun: boolean }) {
    const coverageMap = await super.generateCoverage(context);
    const outputPath = process.env["COVERAGE_CHECK_SUPPLEMENTAL_LCOV"];
    if (!outputPath)
      throw new Error("COVERAGE_CHECK_SUPPLEMENTAL_LCOV is required by coverage-check/vitest");
    const configPath = process.env["COVERAGE_CHECK_CONFIG"] ?? ".coverage-rules.yml";
    const { scope } = loadCoverageConfig(configPath);
    if (!scope)
      throw new Error(`${configPath}: a scope block is required by coverage-check/vitest`);

    const supplemental = coverageMap.files().flatMap((file: string) => {
      const path = normalizeCoveragePath(relative(process.cwd(), file));
      if (coverageDisposition(path, scope) !== "supplemental") return [];
      const fileCoverage = coverageMap.fileCoverageFor(file);
      if (isEmptyCoverageReport(fileCoverage.data)) return [];
      return [{ hits: fileCoverage.getLineCoverage(), path }];
    });
    const resolved = resolve(outputPath);
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, formatSupplementalLcov(supplemental));
    coverageMap.filter(
      (file: string) =>
        coverageDisposition(normalizeCoveragePath(relative(process.cwd(), file)), scope) ===
        "aggregate",
    );
    return coverageMap;
  }
}

export default {
  ...v8CoverageModule,
  async getProvider(): Promise<ScopedV8CoverageProvider> {
    return new ScopedV8CoverageProvider();
  },
};

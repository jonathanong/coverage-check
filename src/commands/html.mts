import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { lcovBufferToIstanbul } from "../lcov-to-istanbul.mts";
import { makeStore } from "../store-factory.mts";
import { assertSafeRef } from "../suite-store.mts";
import type { SuiteStore } from "../suite-store.mts";

export type CoverageHtmlArgs = {
  activeSuites: string[];
  artifacts: string;
  branch: string;
  output: string;
  storeFs: string | null;
  storeS3: string | null;
  stripPrefixes: string[];
};

type SuiteBuffer = { suite: string; source: "current" | "history"; lcov: Buffer };

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseCoverageHtmlArgs(argv: string[]): CoverageHtmlArgs {
  const args: CoverageHtmlArgs = {
    activeSuites: [],
    artifacts: "./coverage-artifacts",
    branch: "main",
    output: "./coverage-html",
    storeFs: null,
    storeS3: null,
    stripPrefixes: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = (): string => {
      const parsed = requireValue(flag, argv[i + 1]);
      i++;
      return parsed;
    };

    switch (flag) {
      case "--active-suite":
        args.activeSuites.push(value());
        break;
      case "--artifacts":
        args.artifacts = value();
        break;
      case "--branch":
        args.branch = assertSafeRef(value(), "branch");
        break;
      case "--output":
        args.output = value();
        break;
      case "--store-fs":
        args.storeFs = value();
        break;
      case "--store-s3":
        args.storeS3 = value();
        break;
      case "--strip-prefix":
        args.stripPrefixes.push(value());
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  if (args.storeFs && args.storeS3)
    throw new Error("--store-fs and --store-s3 are mutually exclusive");
  if (args.branch.length === 0) throw new Error("--branch must not be empty");
  return args;
}

function suiteNameFromArtifactDir(name: string): string | null {
  if (!name.startsWith("coverage-")) return null;
  const suite = name.slice("coverage-".length);
  return suite.length > 0 ? suite : null;
}

function loadCurrentSuiteBuffers(artifacts: string): SuiteBuffer[] {
  if (!existsSync(artifacts)) return [];
  return readdirSync(artifacts, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const suite = suiteNameFromArtifactDir(entry.name);
      if (!suite) return [];
      const files = collectLcovFiles(path.join(artifacts, entry.name));
      if (files.length === 0) return [];
      return [
        {
          suite,
          source: "current" as const,
          lcov: Buffer.concat(files.flatMap((f) => [readFileSync(f), Buffer.from("\n")])),
        },
      ];
    })
    .sort((a, b) => a.suite.localeCompare(b.suite));
}

async function loadHistoricalSuiteBuffers(
  store: SuiteStore | null,
  branch: string,
  activeSuiteNames: Set<string>,
  currentSuiteNames: Set<string>,
): Promise<{ suites: SuiteBuffer[]; warnings: string[] }> {
  if (store === null) {
    return {
      suites: [],
      warnings: [
        "Historical main coverage store was not configured; showing current-run coverage only.",
      ],
    };
  }
  if (activeSuiteNames.size === 0) {
    return {
      suites: [],
      warnings: [
        "Historical main coverage store was configured without an active suite manifest; showing current-run coverage only.",
      ],
    };
  }
  try {
    const historicalNames = [...activeSuiteNames].filter((s) => !currentSuiteNames.has(s));
    const results = await Promise.all(
      historicalNames.map(async (suite) => {
        const lcov = await store.get(suite, { branch });
        return lcov === null ? { missingSuite: suite } : { suite, lcov };
      }),
    );
    const suites: SuiteBuffer[] = results
      .filter((r): r is { suite: string; lcov: Buffer } => "lcov" in r)
      .map((r) => ({ suite: r.suite, source: "history" as const, lcov: r.lcov }));
    const missing = results
      .filter((r): r is { missingSuite: string } => "missingSuite" in r)
      .map((r) => r.missingSuite);
    return {
      suites,
      warnings:
        missing.length === 0
          ? []
          : [
              `Historical main coverage missing for active suites: ${missing.sort((a, b) => a.localeCompare(b)).join(", ")}.`,
            ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { suites: [], warnings: [`Historical main coverage could not be read: ${message}`] };
  }
}

export async function buildCoverageHtml(args: CoverageHtmlArgs): Promise<{ warnings: string[] }> {
  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const currentSuites = loadCurrentSuiteBuffers(args.artifacts);
  const historical = await loadHistoricalSuiteBuffers(
    makeStore({ fs: args.storeFs, s3: args.storeS3 }),
    args.branch,
    new Set(args.activeSuites),
    new Set(currentSuites.map((s) => s.suite)),
  );
  const allSuites = [...currentSuites, ...historical.suites];

  const { CoverageReport } = await import("monocart-coverage-reports");
  const report = new CoverageReport({
    name: "merged coverage",
    outputDir: args.output,
    reports: [["html"]],
    lcov: true,
  });
  for (const suite of allSuites) {
    await report.add(lcovBufferToIstanbul(suite.lcov, stripPrefixes));
  }
  if (allSuites.length > 0) {
    await report.generate();
  }

  return { warnings: historical.warnings };
}

export async function main(argv: string[]): Promise<number> {
  let args: CoverageHtmlArgs;
  try {
    args = parseCoverageHtmlArgs(argv);
  } catch (err) {
    process.stderr.write(`coverage-check html: ${String(err)}\n`);
    return 2;
  }
  const { warnings } = await buildCoverageHtml(args);
  for (const w of warnings) process.stderr.write(`${w}\n`);
  return 0;
}

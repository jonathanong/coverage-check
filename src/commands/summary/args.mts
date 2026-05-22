import type { CoverageSummaryArgs } from "./types.mts";

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseCoverageSummaryArgs(argv: string[]): CoverageSummaryArgs {
  const args: CoverageSummaryArgs = {
    activeSuites: [],
    artifacts: "./coverage-artifacts",
    branch: "main",
    storeFs: null,
    storeS3: null,
    summaryFile: process.env["GITHUB_STEP_SUMMARY"] ?? null,
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
        args.branch = value();
        break;
      case "--rules":
        args.rulesFile = value();
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
      case "--summary-file":
        args.summaryFile = value();
        break;
      case "--no-summary-file":
        args.summaryFile = null;
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

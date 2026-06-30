import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

export type ExpectedSuite = {
  job: string;
  suite: string;
};

export type PrepareArtifactsArgs = {
  artifacts: string;
  expectedSuites: ExpectedSuite[];
};

export type PrepareArtifactsResult = {
  message: string;
  missing: string[];
};

export function parsePrepareArtifactsArgs(argv: string[]): PrepareArtifactsArgs {
  const args: PrepareArtifactsArgs = {
    artifacts: "./coverage-artifacts",
    expectedSuites: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const next = argv[i + 1];
    const val = (): string => {
      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${flag} requires a value`);
      }
      i++;
      return next;
    };
    switch (flag) {
      case "--artifacts":
        args.artifacts = val();
        break;
      case "--expect-suite": {
        const raw = val();
        const eq = raw.indexOf("=");
        if (eq <= 0 || eq === raw.length - 1) {
          throw new Error(
            `--expect-suite must be formatted as <job>=<suite>, got ${JSON.stringify(raw)}`,
          );
        }
        args.expectedSuites.push({ job: raw.slice(0, eq), suite: raw.slice(eq + 1) });
        break;
      }
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  return args;
}

function expectedLcovPath(artifactsDir: string, suite: string): string {
  return join(artifactsDir, `coverage-${suite}`, "lcov.info");
}

export function missingCoverageArtifacts(
  artifactsDir: string,
  expectedSuites: ExpectedSuite[],
): string[] {
  const errors: string[] = [];
  for (const { job, suite } of expectedSuites) {
    if (!existsSync(expectedLcovPath(artifactsDir, suite))) {
      errors.push(`Missing coverage artifact for ${job}: coverage-${suite}/lcov.info`);
    }
  }
  return errors;
}

export function normalizeCoverageArtifacts(
  artifactsDir: string,
  expectedSuites: ExpectedSuite[],
): string {
  const rootLcovPath = join(artifactsDir, "lcov.info");
  if (!existsSync(rootLcovPath)) return "Coverage artifact layout already uses named directories.";

  if (expectedSuites.length === 0) {
    return "No expected coverage suites configured; leaving root-level lcov.info unchanged.";
  }

  if (expectedSuites.length !== 1) {
    const missingNamedSuites = missingCoverageArtifacts(artifactsDir, expectedSuites);
    if (missingNamedSuites.length === 0) {
      unlinkSync(rootLcovPath);
      return "Removed duplicate root-level lcov.info (all expected named coverage artifacts already exist).";
    }

    throw new Error(
      `Root-level lcov.info is only valid for exactly one expected coverage suite; got ${expectedSuites.length}.`,
    );
  }

  const suite = expectedSuites[0]!.suite;
  const targetDir = join(artifactsDir, `coverage-${suite}`);
  const targetPath = join(targetDir, "lcov.info");
  if (existsSync(targetPath)) {
    unlinkSync(rootLcovPath);
    return `Removed duplicate root-level lcov.info (coverage-${suite}/lcov.info already present).`;
  }

  mkdirSync(targetDir, { recursive: true });
  renameSync(rootLcovPath, targetPath);
  return `Normalized root-level lcov.info to coverage-${suite}/lcov.info.`;
}

export function prepareCoverageArtifacts(args: PrepareArtifactsArgs): PrepareArtifactsResult {
  const message = normalizeCoverageArtifacts(args.artifacts, args.expectedSuites);
  return {
    message,
    missing: missingCoverageArtifacts(args.artifacts, args.expectedSuites),
  };
}

export function runPrepareArtifacts(args: PrepareArtifactsArgs): number {
  const result = prepareCoverageArtifacts(args);
  stdout(result.message);
  if (result.missing.length === 0) {
    stdout("Coverage artifacts are complete.");
    return 0;
  }
  for (const error of result.missing) stderr(`::error::${error}`);
  return 1;
}

export function main(argv: string[]): number {
  try {
    return runPrepareArtifacts(parsePrepareArtifactsArgs(argv));
  } catch (error) {
    /* c8 ignore next -- defensive fallback; local command errors throw Error instances */
    const message = error instanceof Error ? error.message : String(error);
    stderr(`coverage-check prepare-artifacts: ${message}`);
    return 2;
  }
}

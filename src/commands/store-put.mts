import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLcov } from "../lcov-parser.mts";
import { mergeLcov, toLcov } from "../lcov-merge.mts";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { makeStore } from "../store-factory.mts";
import { assertSafePathComponent } from "../suite-store.mts";
import type { SuiteStore } from "../suite-store.mts";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

export type StorePutArgs = {
  suite: string;
  suitePrefix: string;
  store: SuiteStore;
  artifacts: string;
  stripPrefixes: string[];
  sha?: string;
  branch?: string;
};

function parseArgs(argv: string[]): StorePutArgs {
  let storeFs: string | null = null;
  let storeS3: string | null = null;
  const args = {
    suite: "",
    suitePrefix: "coverage-",
    artifacts: "./coverage-artifacts",
    stripPrefixes: [] as string[],
    sha: undefined as string | undefined,
    branch: undefined as string | undefined,
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
      case "--suite":
        args.suite = val();
        break;
      case "--suite-prefix":
        args.suitePrefix = val();
        break;
      case "--store":
      case "--store-fs":
        storeFs = val();
        break;
      case "--store-s3":
        storeS3 = val();
        break;
      case "--artifacts":
        args.artifacts = val();
        break;
      case "--strip-prefix":
        args.stripPrefixes.push(val());
        break;
      case "--sha":
        args.sha = val();
        break;
      case "--branch":
        args.branch = val();
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  if (storeFs && storeS3) throw new Error("--store-fs and --store-s3 are mutually exclusive");
  if (!storeFs && !storeS3) throw new Error("--store-fs/--store or --store-s3 is required");
  const hasSha = args.sha !== undefined;
  const hasBranch = args.branch !== undefined;
  if (hasSha !== hasBranch) {
    throw new Error("--sha and --branch must be provided together");
  }
  if (args.suite) {
    assertSafePathComponent(args.suite, "suite");
  }
  if (args.sha !== undefined) {
    assertSafePathComponent(args.sha, "sha");
    if (args.sha.startsWith("-")) throw new Error(`invalid sha (cannot start with '-'): ${JSON.stringify(args.sha)}`);
  }
  if (args.branch !== undefined && (args.branch.length === 0 || args.branch.startsWith("-"))) {
    throw new Error(`invalid branch (cannot start with '-'): ${JSON.stringify(args.branch)}`);
  }

  const store = makeStore({ fs: storeFs, s3: storeS3 })!;
  return { ...args, store };
}

export async function main(argv: string[]): Promise<number> {
  let args: StorePutArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr(`coverage-check store-put: ${String(err)}`);
    return 2;
  }
  if (args.suite) {
    return runStorePut(args);
  }
  return runStorePutMultiSuite(args);
}

async function runStorePutMultiSuite(args: StorePutArgs): Promise<number> {
  let subdirs: string[];
  try {
    subdirs = readdirSync(args.artifacts, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith(args.suitePrefix))
      .map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      stdout(
        `coverage-check store-put: artifacts directory not found at ${args.artifacts}; nothing to store`,
      );
      return 0;
    }
    throw err;
  }

  if (subdirs.length === 0) {
    stdout(
      `coverage-check store-put: no subdirectories matching prefix "${args.suitePrefix}" under ${args.artifacts}; nothing to store`,
    );
    return 0;
  }

  for (const subdirName of subdirs) {
    const suite = subdirName.slice(args.suitePrefix.length);
    const suiteDir = join(args.artifacts, subdirName);
    const suiteArgs: StorePutArgs = { ...args, suite, artifacts: suiteDir };
    await runStorePut(suiteArgs);
  }
  return 0;
}

export async function runStorePut(args: StorePutArgs): Promise<number> {
  const lcovFiles = collectLcovFiles(args.artifacts);
  if (lcovFiles.length === 0) {
    stdout(
      `coverage-check store-put: no lcov.info files under ${args.artifacts}; skipping suite "${args.suite}"`,
    );
    return 0;
  }

  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const reports = lcovFiles.map((f) => parseLcov(readFileSync(f, "utf8"), stripPrefixes));
  const merged = mergeLcov(reports);
  const lcovText = toLcov(merged);

  const meta =
    args.sha !== undefined && args.branch !== undefined
      ? { sha: args.sha, branch: args.branch }
      : undefined;
  await args.store.put(args.suite, Buffer.from(lcovText, "utf8"), meta);

  const metaLabel = args.sha !== undefined ? ` sha=${args.sha} branch=${args.branch}` : "";
  stdout(
    `coverage-check store-put: stored suite "${args.suite}" (${lcovFiles.length} file(s))${metaLabel}`,
  );
  return 0;
}

import { readFileSync } from "node:fs";
import { parseLcov } from "../lcov-parser.mts";
import { mergeLcov, toLcov } from "../lcov-merge.mts";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { makeStore } from "../store-factory.mts";
import type { SuiteStore } from "../suite-store.mts";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

export type StorePutArgs = {
  suite: string;
  store: SuiteStore;
  artifacts: string;
  stripPrefixes: string[];
  sha: string;
  branch: string;
};

function parseArgs(argv: string[]): StorePutArgs {
  let storeFs: string | null = null;
  let storeS3: string | null = null;
  const args = {
    suite: "",
    artifacts: "./coverage-artifacts",
    stripPrefixes: [] as string[],
    sha: "",
    branch: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const next = argv[i + 1];
    const val = (): string => {
      if (next === undefined) throw new Error(`${flag} requires a value`);
      i++;
      return next;
    };
    switch (flag) {
      case "--suite":
        args.suite = val();
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

  if (!args.suite) throw new Error("--suite is required");
  if (storeFs && storeS3) throw new Error("--store-fs and --store-s3 are mutually exclusive");
  if (!storeFs && !storeS3) throw new Error("--store or --store-s3 is required");
  if (!args.sha) throw new Error("--sha is required");
  if (!args.branch) throw new Error("--branch is required");

  const store = makeStore({ fs: storeFs, s3: storeS3 })!;
  return { ...args, store };
}

export async function main(argv: string[]): Promise<number> {
  let args: StorePutArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr(`coverage-check store-put: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
  return runStorePut(args);
}

export async function runStorePut(args: StorePutArgs): Promise<number> {
  const lcovFiles = collectLcovFiles(args.artifacts);
  if (lcovFiles.length === 0) {
    stderr(`coverage-check store-put: no lcov.info files found under ${args.artifacts}`);
    return 2;
  }

  const stripPrefixes = buildStripPrefixes(args.stripPrefixes);
  const reports = lcovFiles.map((f) => parseLcov(readFileSync(f, "utf8"), stripPrefixes));
  const merged = mergeLcov(reports);
  const lcovText = toLcov(merged);

  await args.store.put(args.suite, Buffer.from(lcovText, "utf8"), {
    sha: args.sha,
    branch: args.branch,
  });

  stdout(
    `coverage-check store-put: stored suite "${args.suite}" (${lcovFiles.length} file(s)) sha=${args.sha} branch=${args.branch}`,
  );
  return 0;
}

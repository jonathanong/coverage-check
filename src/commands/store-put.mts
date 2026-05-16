import { readFileSync } from "node:fs";
import { parseLcov } from "../lcov-parser.mts";
import { mergeLcov, toLcov } from "../lcov-merge.mts";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { FileSystemSuiteStore } from "../suite-store.mts";

const stdout = (msg: string) => process.stdout.write(`${msg}\n`);
const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

export type StorePutArgs = {
  suite: string;
  store: string;
  artifacts: string;
  stripPrefixes: string[];
  sha: string | null;
  ref: string | null;
};

function parseArgs(argv: string[]): StorePutArgs {
  const args: StorePutArgs = {
    suite: "",
    store: "",
    artifacts: "./coverage-artifacts",
    stripPrefixes: [],
    sha: null,
    ref: null,
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
        args.store = val();
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
      case "--ref":
        args.ref = val();
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  if (!args.suite) throw new Error("--suite is required");
  if (!args.store) throw new Error("--store is required");
  return args;
}

export async function main(argv: string[]): Promise<number> {
  let args: StorePutArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    /* c8 ignore next */
    stderr(`coverage-check store-put: ${err instanceof Error ? err.message : err}`);
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

  const store = new FileSystemSuiteStore(args.store);
  await store.put(args.suite, Buffer.from(lcovText, "utf8"), {
    sha: args.sha ?? undefined,
    ref: args.ref ?? undefined,
  });

  stdout(
    `coverage-check store-put: stored suite "${args.suite}" (${lcovFiles.length} file(s)) → ${args.store}`,
  );
  return 0;
}

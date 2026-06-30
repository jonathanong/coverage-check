import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseLcov } from "../lcov-parser.mts";
import { mergeLcov, toLcov } from "../lcov-merge.mts";
import { collectLcovFiles, buildStripPrefixes } from "../load-artifacts.mts";
import { makeStore } from "../store-factory.mts";
import { parseArgs as parseCliArgs } from "../parse-args.mts";
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
  const args = parseCliArgs<{
    suite: string;
    "suite-prefix": string;
    store?: string;
    "store-fs"?: string;
    "store-s3"?: string;
    artifacts: string;
    "strip-prefix": string[];
    sha?: string;
    branch?: string;
  }>(argv, {
    suite: { type: "string", default: "" },
    "suite-prefix": { type: "string", default: "coverage-" },
    store: { type: "string" },
    "store-fs": { type: "string" },
    "store-s3": { type: "string" },
    artifacts: { type: "string", default: "./coverage-artifacts" },
    "strip-prefix": { type: "string", multiple: true, default: [] },
    sha: { type: "string" },
    branch: { type: "string" },
  });

  const storeFs = args.store ?? args["store-fs"] ?? null;
  const storeS3 = args["store-s3"] ?? null;
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
  if (args.sha !== undefined) assertSafePathComponent(args.sha, "sha");
  if (args.branch !== undefined && args.branch.length === 0) {
    throw new Error(`invalid branch: ${JSON.stringify(args.branch)}`);
  }

  const store = makeStore({ fs: storeFs, s3: storeS3 })!;
  return {
    suite: args.suite,
    suitePrefix: args["suite-prefix"],
    store,
    artifacts: args.artifacts,
    stripPrefixes: args["strip-prefix"],
    sha: args.sha,
    branch: args.branch,
  };
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

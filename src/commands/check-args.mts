import { makeStore } from "../store-factory.mts";
import { assertSafePathComponent, assertValidRepo } from "../suite-store.mts";
import type { SuiteStore } from "../suite-store.mts";
import type { GhRunner } from "../github-comment.mts";

export type CheckArgs = {
  rules: string;
  artifacts: string;
  base: string;
  head: string;
  pr: number | null;
  repo: string;
  json: string | null;
  stripPrefixes: string[];
  store: SuiteStore | null;
  suite: string | null;
  /** Branch used to resolve baseline from the store. Default: "main". */
  branch?: string;
  gh?: GhRunner;
  /** Path to append the GitHub step summary. Default: $GITHUB_STEP_SUMMARY. */
  summaryFile?: string | null;
  /** Annotate each uncovered line with its trimmed source text in stdout. Default: false. */
  annotateSource?: boolean;
  /** Exit 0 even on coverage shortfall — compute and print, but never block. Default: false. */
  advisory?: boolean;
  /** Apply no_coverage_drop only to rules whose area has changed files in the diff. Default: false. */
  dropOnlyChangedAreas?: boolean;
  /** Relative paths under --artifacts that must exist before the check runs (repeatable). */
  requireArtifacts?: string[];
};

export function parseCheckArgs(argv: string[]): CheckArgs {
  let storeFs: string | null = null;
  let storeS3: string | null = null;
  const args: Omit<CheckArgs, "store"> & { store: SuiteStore | null } = {
    rules: ".coverage-rules.yml",
    artifacts: "./coverage-artifacts",
    base: "origin/main",
    head: "HEAD",
    pr: null,
    repo: process.env["GITHUB_REPOSITORY"] ?? "",
    json: null,
    stripPrefixes: [],
    store: null,
    suite: null,
    branch: "main",
    summaryFile: process.env["GITHUB_STEP_SUMMARY"] ?? null,
    annotateSource: false,
    advisory: false,
    dropOnlyChangedAreas: false,
    requireArtifacts: [],
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
      case "--rules":
        args.rules = val();
        break;
      case "--artifacts":
        args.artifacts = val();
        break;
      case "--base":
        args.base = val();
        break;
      case "--head":
        args.head = val();
        break;
      case "--repo":
        args.repo = val();
        break;
      case "--json":
        args.json = val();
        break;
      case "--suite": {
        const s = val();
        assertSafePathComponent(s, "suite");
        args.suite = s;
        break;
      }
      case "--strip-prefix":
        args.stripPrefixes.push(val());
        break;
      case "--branch": {
        const branch = val();
        if (branch.length === 0) throw new Error(`invalid branch: ${JSON.stringify(branch)}`);
        args.branch = branch;
        break;
      }
      case "--store":
      case "--store-fs":
        storeFs = val();
        break;
      case "--store-s3":
        storeS3 = val();
        break;
      case "--pr": {
        const raw = val();
        if (!/^\d+$/.test(raw) || raw === "0")
          throw new Error(`--pr must be a positive integer, got: ${JSON.stringify(raw)}`);
        args.pr = parseInt(raw, 10);
        break;
      }
      case "--annotate-source":
        args.annotateSource = true;
        break;
      case "--advisory":
        args.advisory = true;
        break;
      case "--drop-only-changed-areas":
        args.dropOnlyChangedAreas = true;
        break;
      case "--require-artifact":
        args.requireArtifacts!.push(val());
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }

  if (storeFs && storeS3) throw new Error("--store-fs and --store-s3 are mutually exclusive");

  const repo = args.repo.trim();
  args.repo = repo;
  if (args.pr !== null && repo.length === 0) {
    throw new Error("--repo is required when --pr is set (or define GITHUB_REPOSITORY)");
  }
  if (repo !== "") {
    args.repo = assertValidRepo(repo);
  }
  args.store = makeStore({ fs: storeFs, s3: storeS3 });
  return args;
}

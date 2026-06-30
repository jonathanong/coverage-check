import { main as checkMain } from "./commands/check.mts";
import { checkHelp } from "./commands/check-render.mts";
import { main as storePutMain } from "./commands/store-put.mts";
import { main as mergeMain } from "./commands/merge.mts";
import { main as prepareArtifactsMain } from "./commands/prepare-artifacts.mts";

const stderr = (msg: string) => process.stderr.write(`${msg}\n`);
const stdout = (msg: string) => process.stdout.write(`${msg}\n`);

export async function main(argv: string[]): Promise<number> {
  const sub = argv[0];

  if (sub === "--help" || sub === "-h") {
    stdout(help());
    return 0;
  }
  if (!sub || sub.startsWith("-")) return checkMain(argv);
  if (sub === "check") return checkMain(argv.slice(1));
  if (sub === "store-put") return storePutMain(argv.slice(1));
  if (sub === "merge") return mergeMain(argv.slice(1));
  if (sub === "prepare-artifacts") return prepareArtifactsMain(argv.slice(1));

  stderr(`coverage-check: unknown subcommand: ${JSON.stringify(sub)}`);
  return 2;
}

function help(): string {
  return `coverage-check

Usage:
  coverage-check <command> [options]
  coverage-check [check options]

Commands:
  check       Check patch coverage (default)
  store-put   Store suite LCOV data
  merge       Merge lcov.info files
  prepare-artifacts
              Normalize downloaded coverage artifacts

${checkHelp()}`;
}

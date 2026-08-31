import { main as checkMain } from "./commands/check.mts";
import { checkHelp } from "./commands/check-render.mts";
import { main as storePutMain } from "./commands/store-put.mts";
import { main as htmlMain } from "./commands/html.mts";
import { main as mergeMain } from "./commands/merge.mts";
import { main as summaryMain } from "./commands/summary.mts";
import { main as prepareArtifactsMain } from "./commands/prepare-artifacts.mts";
import { main as compareSummaryMain } from "./commands/compare-summary.mts";

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
  if (sub === "html") return htmlMain(argv.slice(1));
  if (sub === "summary") return summaryMain(argv.slice(1));
  if (sub === "prepare-artifacts") return prepareArtifactsMain(argv.slice(1));
  if (sub === "compare-summary") return compareSummaryMain(argv.slice(1));

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
  html        Generate HTML coverage reports
  summary     Generate a coverage summary
  compare-summary  Compare historical Istanbul coverage summaries

${checkHelp()}`;
}

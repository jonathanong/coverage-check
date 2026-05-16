import { main as checkMain } from "./commands/check.mts";
import { main as storePutMain } from "./commands/store-put.mts";

const stderr = (msg: string) => process.stderr.write(`${msg}\n`);

export async function main(argv: string[]): Promise<number> {
  const sub = argv[0];

  if (!sub || sub.startsWith("-")) return checkMain(argv);
  if (sub === "check") return checkMain(argv.slice(1));
  if (sub === "store-put") return storePutMain(argv.slice(1));

  stderr(`coverage-check: unknown subcommand: ${JSON.stringify(sub)}`);
  return 2;
}

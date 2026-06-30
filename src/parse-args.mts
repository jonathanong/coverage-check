import { parseArgs as parseNodeArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";

export function parseArgs<T extends Record<string, unknown>>(
  argv: string[],
  options: ParseArgsConfig["options"],
): T {
  try {
    return parseNodeArgs({
      args: argv,
      allowPositionals: false,
      options,
      strict: true,
    }).values as T;
  } catch (error: unknown) {
    throw new Error(formatParseArgsError(error as Error));
  }
}

function formatParseArgsError(error: Error): string {
  const unknown = error.message.match(/^Unknown option '([^']+)'$/);
  if (unknown) return `unknown flag: ${unknown[1]}`;
  const missing = error.message.match(/^Option '([^' ]+)(?: <value>)?' argument missing$/);
  if (missing) return `${missing[1]} requires a value`;
  const ambiguous = error.message.match(/^Option '([^']+)' argument is ambiguous\./);
  if (ambiguous) return `${ambiguous[1]} requires a value`;
  return error.message;
}

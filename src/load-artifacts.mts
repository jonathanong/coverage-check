import { globSync } from "node:fs";
import { join } from "node:path";

/** Recursively collects all lcov.info files under the given directory. */
export function collectLcovFiles(dir: string): string[] {
  return globSync("**/lcov.info", { cwd: dir }).map((file) => join(dir, file));
}

/**
 * Builds the list of path prefixes to strip from LCOV SF: lines.
 *
 * Defaults: $GITHUB_WORKSPACE (if set) and cwd are always prepended.
 * Additional prefixes can be passed via the `extra` parameter.
 */
export function buildStripPrefixes(extra: string[] = []): string[] {
  const prefixes: string[] = extra.map((p) => (p.endsWith("/") ? p : `${p}/`));
  const ws = process.env["GITHUB_WORKSPACE"];
  if (ws) prefixes.push(ws.endsWith("/") ? ws : `${ws}/`);
  const cwd = process.cwd();
  /* c8 ignore next -- process.cwd() virtually never returns a trailing-slash path */
  prefixes.push(cwd.endsWith("/") ? cwd : `${cwd}/`);
  return prefixes;
}

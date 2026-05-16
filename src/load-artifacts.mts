import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Recursively collects all lcov.info files under the given directory. */
export function collectLcovFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectLcovFiles(full));
      } else if (entry.name === "lcov.info") {
        results.push(full);
      }
    }
  } catch (err) {
    /* c8 ignore next */
    if ((err as NodeJS.ErrnoException).code !== "ENOENT")
      /* c8 ignore next */
      process.stderr.write(
        `coverage-check: unexpected error reading artifacts directory ${dir}: ${err}\n`,
      );
    // ENOENT: directory does not exist — no artifacts
  }
  return results;
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

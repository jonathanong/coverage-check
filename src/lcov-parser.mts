import type { LcovData } from "./types.mts";

/**
 * Parses LCOV text into a map of repo-root-relative file path → line → hit count.
 *
 * Paths are normalized by stripping a given prefix (e.g. $GITHUB_WORKSPACE or cwd)
 * so callers see repo-root-relative paths regardless of where the runner ran.
 */
export function parseLcov(text: string, stripPrefixes: string[] = []): LcovData {
  const result: LcovData = new Map();
  let currentLines: Map<number, number> | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();

    if (line.startsWith("SF:")) {
      let path = line.slice(3);
      let stripped = false;
      for (const prefix of stripPrefixes) {
        if (path.startsWith(prefix)) {
          path = path.slice(prefix.length);
          stripped = true;
          break;
        }
      }

      if (!stripped && path.startsWith("/")) {
        const match = path.match(/^.*?\/_?work\/([^/]+)\/\1\//);
        if (match) {
          path = path.slice(match[0].length);
        }
      }

      path = normalizePath(path);
      currentLines = result.get(path) ?? new Map();
      result.set(path, currentLines);
    } else if (line.startsWith("DA:") && currentLines !== null) {
      const rest = line.slice(3);
      const comma = rest.indexOf(",");
      if (comma === -1) continue;
      const lineNo = parseInt(rest.slice(0, comma), 10);
      const hits = parseInt(rest.slice(comma + 1), 10);
      if (!Number.isFinite(lineNo) || !Number.isFinite(hits)) continue;
      const prev = currentLines.get(lineNo) ?? 0;
      currentLines.set(lineNo, prev + hits);
    } else if (line === "end_of_record") {
      currentLines = null;
    }
  }

  return result;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

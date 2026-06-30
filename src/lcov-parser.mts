import { forEachTrimmedLine } from "./for-each-line.mts";
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

  forEachTrimmedLine(text, (line) => {
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

      path = normalizePath(path);

      if (!stripped && (path.startsWith("/") || /^[A-Z]:\//i.test(path))) {
        const match = path.match(/^.*?\/_?work\/([^/]+)\/\1\//);
        if (match) {
          path = path.slice(match[0].length);
        }
      }

      currentLines = result.get(path) ?? null;
      if (!currentLines) {
        currentLines = new Map();
        result.set(path, currentLines);
      }
    } else if (line.startsWith("DA:") && currentLines !== null) {
      const comma = line.indexOf(",", 3);
      if (comma !== -1) {
        const lineNo = parseInt(line.slice(3, comma), 10);
        const hits = parseInt(line.slice(comma + 1), 10);
        if (Number.isFinite(lineNo) && Number.isFinite(hits)) {
          const prev = currentLines.get(lineNo) ?? 0;
          currentLines.set(lineNo, prev + hits);
        }
      }
    } else if (line === "end_of_record") {
      currentLines = null;
    }
  });

  return result;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

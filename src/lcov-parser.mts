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

  // Keep parsing line-by-line via indices to avoid a per-line string allocation.
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;

    const lineStart = start;
    const lineEnd = trimLineEnd(text, lineStart, end);

    if (text.startsWith("SF:", lineStart)) {
      let path = text.slice(lineStart + 3, lineEnd);
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

      let existing = result.get(path);
      if (existing === undefined) {
        existing = new Map();
        result.set(path, existing);
      }
      currentLines = existing;
    } else if (text.startsWith("DA:", lineStart) && currentLines !== null) {
      const comma = text.indexOf(",", lineStart + 3);
      if (comma !== -1 && comma < lineEnd) {
        const lineNo = parseInt(text.slice(lineStart + 3, comma), 10);
        const hits = parseInt(text.slice(comma + 1, lineEnd), 10);
        if (Number.isFinite(lineNo) && Number.isFinite(hits)) {
          const prev = currentLines.get(lineNo) ?? 0;
          currentLines.set(lineNo, prev + hits);
        }
      }
    } else if (lineEnd - lineStart === 13 && text.startsWith("end_of_record", lineStart)) {
      currentLines = null;
    }

    start = end + 1;
  }

  return result;
}

function trimLineEnd(text: string, start: number, end: number): number {
  while (end > start) {
    const charCode = text.charCodeAt(end - 1);
    if (charCode === 32 || charCode === 9 || charCode === 13) {
      end--;
      continue;
    }
    break;
  }
  return end;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

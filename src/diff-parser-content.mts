import { decodeGitCString, runGitDiff } from "./diff-parser.mts";
import type { DiffLineContent } from "./types.mts";

/**
 * Parses the output of `git diff --unified=0` into a map of
 * repo-root-relative file path → map of added line number → trimmed source text.
 *
 * The cursor advances only on `+` (added) content lines, not `-` (removed) lines.
 * With --unified=0 there are no context lines, so cursor alignment is exact.
 */
export function parseDiffWithContent(text: string): DiffLineContent {
  const result: DiffLineContent = new Map();
  let currentContent: Map<number, string> | null = null;
  let cursor = 0;
  let inHeader = false;

  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;

    let lineEnd = end;
    while (lineEnd > start) {
      const charCode = text.charCodeAt(lineEnd - 1);
      if (charCode === 32 || charCode === 9 || charCode === 13) {
        lineEnd--;
        continue;
      }
      break;
    }

    const line = text.slice(start, lineEnd);
    start = end + 1;

    // Only parse +++ as a file header when in the diff header block
    // (after `diff --git` / `---`). Without this guard a source line beginning
    // with `++ b/` would appear as `+++ b/…` in the diff and be misclassified.
    let newFilePath: string | null = null;
    if (inHeader) {
      if (line.startsWith("+++ b/")) {
        newFilePath = line.slice(6);
      } else if (line.startsWith('+++ "b/') && line.endsWith('"')) {
        newFilePath = decodeGitCString(line.slice(5, -1)).slice(2);
      }
    }

    if (newFilePath !== null) {
      inHeader = false;
      const path = newFilePath;
      if (path === "dev/null") {
        currentContent = null;
        continue;
      }
      currentContent = result.get(path) ?? new Map();
      result.set(path, currentContent);
    } else if (line.startsWith("--- ")) {
      // ignore (part of diff header)
    } else if (line.startsWith("@@ ") && currentContent !== null) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (!match) continue;
      const newStart = parseInt(match[1]!, 10);
      const newCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
      if (newCount === 0) continue;
      cursor = newStart;
    } else if (line.startsWith("diff --git ")) {
      currentContent = null;
      inHeader = true;
    } else if (currentContent !== null && cursor > 0 && line.startsWith("+")) {
      // added content line inside a hunk body; "+++ b/" headers handled above
      currentContent.set(cursor, line.slice(1).trim());
      cursor++;
    }
  }

  return result;
}

/** Runs git diff and returns added-line content for each file. */
export async function getChangedLineContent(
  baseRef: string,
  headRef: string,
): Promise<DiffLineContent> {
  return parseDiffWithContent(await runGitDiff(baseRef, headRef));
}

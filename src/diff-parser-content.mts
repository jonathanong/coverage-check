import { decodeGitCString, runGitDiff } from "./diff-parser.mts";
import type { DiffLineContent } from "./types.mts";

/** Trims trailing whitespace/CR from the end position. */
function trimEnd(text: string, start: number, end: number): number {
  while (end > start) {
    const c = text.charCodeAt(end - 1);
    if (c === 32 || c === 9 || c === 13) {
      end--;
      continue;
    }
    break;
  }
  return end;
}

/**
 * Parses a `+++ b/<path>` header line when in the diff header block.
 * Returns the path or null when not in a header or the line doesn't match.
 */
function parseNewFilePath(line: string, inHeader: boolean): string | null {
  if (!inHeader) return null;
  if (line.startsWith("+++ b/")) return line.slice(6);
  if (line.startsWith('+++ "b/') && line.endsWith('"')) {
    return decodeGitCString(line.slice(5, -1)).slice(2);
  }
  return null;
}

/**
 * Parses a `@@ ... @@` hunk header.
 * Returns the new-file start line number, or null when the hunk should be skipped.
 */
function parseHunkStart(line: string): number | null {
  const HUNK_RE = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  const match = HUNK_RE.exec(line);
  if (match === null) return null;
  const newCount = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
  if (newCount === 0) return null;
  return Number.parseInt(match[1], 10);
}

/**
 * Parses the output of `git diff --unified=0` into a map of
 * repo-root-relative file path → map of added line number → trimmed source text.
 *
 * The cursor advances only on `+` (added) content lines, not `-` (removed) lines.
 * With --unified=0 there are no context lines, so cursor alignment is exact.
 * Cursor is reset to 0 on each file transition, so `cursor > 0` implies
 * `currentContent !== null` (a valid hunk was seen for the current file).
 */
export function parseDiffWithContent(text: string): DiffLineContent {
  const result: DiffLineContent = new Map();
  let currentContent: Map<number, string> | null = null;
  let cursor = 0;
  let inHeader = false;

  let start = 0;
  while (start < text.length) {
    const rawEnd = text.indexOf("\n", start);
    const end = rawEnd === -1 ? text.length : rawEnd;
    const line = text.slice(start, trimEnd(text, start, end));
    start = end + 1;

    const newFilePath = parseNewFilePath(line, inHeader);
    if (newFilePath !== null) {
      inHeader = false;
      cursor = 0;
      if (newFilePath === "dev/null") {
        currentContent = null;
        continue;
      }
      currentContent = result.get(newFilePath) ?? new Map();
      result.set(newFilePath, currentContent);
    } else if (line.startsWith("--- ")) {
      // ignore (part of diff header)
    } else if (line.startsWith("@@ ") && currentContent !== null) {
      cursor = parseHunkStart(line) ?? cursor;
    } else if (line.startsWith("diff --git ")) {
      currentContent = null;
      cursor = 0;
      inHeader = true;
    } else if (cursor > 0 && line.startsWith("+")) {
      // added content line inside a hunk body; "+++ b/" headers handled above.
      // cursor > 0 guarantees currentContent !== null (cursor is reset on file transitions).
      currentContent!.set(cursor, line.slice(1).trim());
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

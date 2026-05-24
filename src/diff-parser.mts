import type { DiffLines } from "./types.mts";
import { forEachTrimmedLine } from "./for-each-line.mts";

/**
 * Decodes a git C-string (inner content between surrounding double-quotes).
 * Git quotes unusual paths (non-ASCII, spaces, etc.) with core.quotePath=true.
 * Handles octal byte escapes (\nnn), \\, \", \n, \t.
 */
export function decodeGitCString(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; ) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const next = s[i + 1]!;
      if (next >= "0" && next <= "7") {
        bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
        i += 4;
      } else if (next === "\\") {
        bytes.push(92);
        i += 2;
      } else if (next === '"') {
        bytes.push(34);
        i += 2;
      } else if (next === "n") {
        bytes.push(10);
        i += 2;
      } else if (next === "t") {
        bytes.push(9);
        i += 2;
      } else {
        bytes.push(s.charCodeAt(i));
        i++;
      }
    } else {
      bytes.push(s.charCodeAt(i));
      i++;
    }
  }
  return Buffer.from(new Uint8Array(bytes)).toString("utf8");
}

/**
 * Parses the output of `git diff --unified=0` into a map of
 * repo-root-relative file path → set of added/modified line numbers.
 *
 * Only added lines (lines in the new version) are tracked. Deleted-only
 * hunks (where the `+` count is 0) are skipped.
 */
export function parseDiff(text: string): DiffLines {
  const result: DiffLines = new Map();
  let currentLines: Set<number> | null = null;
  let inHeader = false;
  const toNumericHeader = (value: string): number | null => {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  };

  forEachTrimmedLine(text, (line) => {
    // Only parse +++ as a file header when we are in the diff header block
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
        currentLines = null;
        return;
      }
      let existing = result.get(path);
      if (existing === undefined) {
        existing = new Set();
        result.set(path, existing);
      }
      currentLines = existing;
    } else if (line.startsWith("--- ")) {
      // ignore (part of diff header)
    } else if (line.startsWith("@@ ") && currentLines !== null) {
      // Avoid regex overhead for fast parsing of: @@ -old_start[,old_count] +new_start[,new_count] @@
      const space1 = line.indexOf(" ", 3); // space after @@ -...
      if (space1 === -1) return;
      const plusPos = space1 + 1;
      if (line[plusPos] !== "+") return;
      const space2 = line.indexOf(" ", plusPos); // space after +...
      if (space2 === -1) return;

      let newStart = 0;
      let newCount = 0;
      let commaPos = -1;
      for (let i = plusPos + 1; i < space2; i++) {
        if (line[i] === ",") {
          commaPos = i;
          break;
        }
      }

      if (commaPos === -1) {
        const parsedStart = toNumericHeader(line.slice(plusPos + 1, space2));
        if (parsedStart === null) return;
        newStart = parsedStart;
        newCount = 1;
      } else {
        const parsedStart = toNumericHeader(line.slice(plusPos + 1, commaPos));
        const parsedCount = toNumericHeader(line.slice(commaPos + 1, space2));
        if (parsedStart === null || parsedCount === null) return;
        newStart = parsedStart;
        newCount = parsedCount;
      }

      if (!Number.isFinite(newStart) || !Number.isFinite(newCount)) return;
      if (newStart <= 0 || newCount <= 0) return;
      for (let i = 0; i < newCount; i++) {
        currentLines.add(newStart + i);
      }
    } else if (line.startsWith("diff --git ")) {
      currentLines = null;
      inHeader = true;
    }
  });

  return result;
}

/** Runs git diff and returns the parsed result. */
export async function getChangedLines(baseRef: string, headRef: string): Promise<DiffLines> {
  const { spawn } = await import("node:child_process");
  const spawnProcess = (cmd: string, args: string[]) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
      proc.on("error", reject);
      proc.on("close", (code) =>
        code === 0
          ? resolve(Buffer.concat(chunks).toString("utf8"))
          : reject(new Error(`${cmd} exited with code ${code}`)),
      );
    });

  const mergeBase = await spawnProcess("git", ["merge-base", baseRef, headRef]);
  const base = mergeBase.trim();
  // --src-prefix/--dst-prefix override diff.noprefix and diff.mnemonicPrefix git config
  const diff = await spawnProcess("git", [
    "diff",
    "--unified=0",
    "--inter-hunk-context=0",
    "--no-color",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    base,
    headRef,
  ]);
  return parseDiff(diff);
}

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Lists untracked, non-ignored files as repo-root-relative paths, regardless of cwd. */
async function listUntrackedFiles(cwd: string | undefined): Promise<string[]> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn("git", ["ls-files", "--others", "--exclude-standard", "--full-name"], {
      stdio: ["ignore", "pipe", "inherit"],
      cwd,
    });
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve(
            Buffer.concat(chunks)
              .toString("utf8")
              .split("\n")
              .filter((line) => line.length > 0),
          )
        : reject(new Error(`git ls-files exited with code ${code}`)),
    );
  });
}

/**
 * Synthesizes a minimal unified-diff block for one untracked file, treating every
 * line as added. Only emits the line prefixes parseDiff/parseDiffWithContent read
 * (`diff --git `, `+++ b/`, `@@ ... @@`, `+<content>`) — real-git-only lines like
 * `new file mode` and `index ...` are inert to both parsers, so they're omitted.
 */
function untrackedFileDiff(path: string, cwd: string | undefined): string {
  // cwd is optional on the public API; the temp-repo test fixtures always pass it explicitly.
  /* c8 ignore next */
  const absPath = join(cwd ?? ".", path);
  const content = readFileSync(absPath, "utf8");
  const lines = content.length === 0 ? [] : content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return "";

  const body = lines.map((line) => `+${line}`).join("\n");
  return `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
}

/** Builds synthetic "every line added" diff text for all untracked files under cwd. */
export async function buildUntrackedDiff(cwd?: string): Promise<string> {
  const paths = await listUntrackedFiles(cwd);
  return paths
    .map((path) => untrackedFileDiff(path, cwd))
    .filter((block) => block.length > 0)
    .join("");
}

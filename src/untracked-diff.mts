import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Spawns a git subcommand and resolves with its raw stdout bytes. */
async function runGit(args: string[], cwd: string | undefined): Promise<Buffer> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn("git", args, { stdio: ["ignore", "pipe", "inherit"], cwd });
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`git ${args[0]} exited with code ${code}`)),
    );
  });
}

/** Resolves the absolute repo root, independent of the invocation cwd. */
export async function resolveRepoRoot(cwd?: string): Promise<string> {
  const out = await runGit(["rev-parse", "--show-toplevel"], cwd);
  return out.toString("utf8").trim();
}

/**
 * Lists untracked, non-ignored files as repo-root-relative paths, regardless of cwd.
 * Uses -z (NUL-delimited, unquoted) so unusual filenames (non-ASCII, control bytes)
 * come back as their exact bytes instead of git's C-quoted `"..."` form.
 */
async function listUntrackedFiles(cwd: string | undefined): Promise<string[]> {
  const out = await runGit(
    ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"],
    cwd,
  );
  return out
    .toString("utf8")
    .split("\0")
    .filter((line) => line.length > 0);
}

/**
 * Synthesizes a minimal unified-diff block for one untracked file, treating every
 * line as added. Only emits the line prefixes parseDiff/parseDiffWithContent read
 * (`diff --git `, `+++ b/`, `@@ ... @@`, `+<content>`) — real-git-only lines like
 * `new file mode` and `index ...` are inert to both parsers, so they're omitted.
 */
function untrackedFileDiff(path: string, repoRoot: string): string {
  if (path.includes("\n") || path.includes("\r")) {
    // parseDiff/parseDiffWithContent split on newlines; a filename containing one
    // cannot be represented in this synthetic (non-git-generated) diff text.
    throw new Error(
      `untracked file name contains a line break, unsupported: ${JSON.stringify(path)}`,
    );
  }
  const content = readFileSync(join(repoRoot, path), "utf8");
  const lines = content.length === 0 ? [] : content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return "";

  const body = lines.map((line) => `+${line}`).join("\n");
  return `diff --git a/${path} b/${path}\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
}

/** Builds synthetic "every line added" diff text for all untracked files under cwd. */
export async function buildUntrackedDiff(cwd?: string): Promise<string> {
  const paths = await listUntrackedFiles(cwd);
  if (paths.length === 0) return "";
  const repoRoot = await resolveRepoRoot(cwd);
  return paths
    .map((path) => untrackedFileDiff(path, repoRoot))
    .filter((block) => block.length > 0)
    .join("");
}

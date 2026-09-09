import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDiff } from "./diff-parser.mts";
import { buildUntrackedDiff } from "./untracked-diff.mts";

function makeRepo(): { repoDir: string; git: (args: string[]) => string } {
  const repoDir = mkdtempSync(join(tmpdir(), "coverage-check-untracked-"));
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: repoDir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@t.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@t.com",
      },
    });
  git(["init", "-q"]);
  return { repoDir, git };
}

describe("buildUntrackedDiff", () => {
  it("rejects when git ls-files fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-check-not-a-repo-"));
    try {
      await expect(buildUntrackedDiff(dir)).rejects.toThrow("git ls-files exited with code");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes untracked files with non-ASCII names, unquoted via -z", async () => {
    const { repoDir, git } = makeRepo();
    try {
      writeFileSync(join(repoDir, "base.mts"), "a\n");
      git(["add", "."]);
      git(["commit", "-q", "-m", "base"]);

      writeFileSync(join(repoDir, "café.mts"), "hola\n");

      const diff = await buildUntrackedDiff(repoDir);

      expect(parseDiff(diff).get("café.mts")).toEqual(new Set([1]));
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it("throws a clear error for an untracked file name containing a line break", async () => {
    const { repoDir, git } = makeRepo();
    try {
      writeFileSync(join(repoDir, "base.mts"), "a\n");
      git(["add", "."]);
      git(["commit", "-q", "-m", "base"]);

      writeFileSync(join(repoDir, "weird\nname.mts"), "x\n");

      await expect(buildUntrackedDiff(repoDir)).rejects.toThrow("line break");
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  });
});

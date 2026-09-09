import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  it("rejects when git rev-parse fails outside a repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-check-not-a-repo-"));
    try {
      await expect(buildUntrackedDiff(dir)).rejects.toThrow("git rev-parse exited with code");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds untracked files outside the invocation cwd via the repo root", async () => {
    const { repoDir, git } = makeRepo();
    try {
      writeFileSync(join(repoDir, "base.mts"), "a\n");
      git(["add", "."]);
      git(["commit", "-q", "-m", "base"]);

      mkdirSync(join(repoDir, "sub"));
      writeFileSync(join(repoDir, "sub", "inside.mts"), "b\n");
      writeFileSync(join(repoDir, "root-level.mts"), "c\n");

      // ls-files only traverses from its own cwd — invoking it with cwd=sub must
      // still surface root-level.mts, which lives outside that cwd.
      const diff = await buildUntrackedDiff(join(repoDir, "sub"));
      const parsed = parseDiff(diff);

      expect(parsed.get("sub/inside.mts")).toEqual(new Set([1]));
      expect(parsed.get("root-level.mts")).toEqual(new Set([1]));
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
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

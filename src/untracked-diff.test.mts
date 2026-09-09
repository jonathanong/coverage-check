import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildUntrackedDiff } from "./untracked-diff.mts";

describe("buildUntrackedDiff", () => {
  it("rejects when git ls-files fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-check-not-a-repo-"));
    try {
      await expect(buildUntrackedDiff(dir)).rejects.toThrow("git ls-files exited with code");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

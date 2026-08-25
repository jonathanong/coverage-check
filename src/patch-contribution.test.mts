import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLcov } from "./lcov-parser.mts";
import { mergeLcov } from "./lcov-merge.mts";
import { computePatchCoverage } from "./patch-coverage.mts";
import {
  changedLinesDigest,
  createPatchCoverageContribution,
  projectPatchLcov,
} from "./patch-contribution.mts";
import { validatePatchCoverageContribution } from "./patch-contribution-validation.mts";

describe("patch LCOV contributions", () => {
  it("preserves the full-report patch result across overlapping shards and zero hits", () => {
    const changed = new Map([["src/renamed file.mts", new Set([1, 2, 4])]]);
    const first = "SF:src/renamed file.mts\nDA:1,0\nDA:2,1\nDA:3,8\nend_of_record\n";
    const second = "SF:src/renamed file.mts\nDA:1,2\nDA:2,0\nDA:4,0\nend_of_record\n";
    const full = computePatchCoverage(changed, mergeLcov([parseLcov(first), parseLcov(second)]), [
      { paths: "src/**", patch_coverage_min: 0 },
    ]);
    const sparse = computePatchCoverage(
      changed,
      mergeLcov([
        parseLcov(projectPatchLcov(first, changed)),
        parseLcov(projectPatchLcov(second, changed)),
      ]),
      [{ paths: "src/**", patch_coverage_min: 0 }],
    );
    expect(sparse).toEqual(full);
  });

  it("keeps an empty changed-file SF record and produces deterministic patch identity", () => {
    const changed = new Map([["src/a.mts", new Set([9])]]);
    expect(projectPatchLcov("SF:src/a.mts\nDA:1,1\nend_of_record\n", changed)).toBe(
      "SF:src/a.mts\nend_of_record\n",
    );
    expect(changedLinesDigest(changed)).toBe(
      changedLinesDigest(new Map([["src/a.mts", new Set([9])]])),
    );
  });

  it("supports empty patch contributions and representative LCOV record forms", () => {
    const changed = new Map([["swift/App.swift", new Set([4])]]);
    expect(
      projectPatchLcov("TN:coverlet\nSF:dotnet/App.cs\nDA:2,1\nend_of_record\n", changed),
    ).toBe("");
    expect(
      projectPatchLcov("TN:llvm\nSF:swift/App.swift\nFN:4,work\nDA:4,1\nend_of_record\n", changed),
    ).toContain("DA:4,1");
  });

  it("creates and validates a provenance-bound sparse contribution", async () => {
    const root = mkdtempSync(join(tmpdir(), "coverage-patch-contribution-"));
    const git = (args: string[]) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "T",
          GIT_AUTHOR_EMAIL: "t@t.com",
          GIT_COMMITTER_NAME: "T",
          GIT_COMMITTER_EMAIL: "t@t.com",
        },
      }).trim();
    try {
      git(["init", "-q"]);
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "a.mts"), "export const a = 1;\n");
      git(["add", "."]);
      git(["commit", "-qm", "base"]);
      const base = git(["rev-parse", "HEAD"]);
      writeFileSync(join(root, "src", "a.mts"), "export const a = 1;\nexport const b = 2;\n");
      git(["add", "."]);
      git(["commit", "-qm", "head"]);
      const head = git(["rev-parse", "HEAD"]);
      const coverage = join(root, "coverage");
      mkdirSync(coverage);
      const lcovPath = join(coverage, "lcov.info");
      const manifestPath = join(coverage, "coverage-manifest.json");
      writeFileSync(lcovPath, "SF:src/a.mts\nDA:1,1\nDA:2,0\nend_of_record\n");
      const descriptor = {
        suite: "unit",
        projects: ["unit"],
        collector: { name: "vitest", settings: { provider: "v8" } },
      };
      const manifest = await createPatchCoverageContribution({
        root,
        lcovPath,
        manifestPath,
        descriptor,
        repository: "example/repo",
        revision: head,
        run: { id: "42", attempt: 1 },
        collectorVersion: "4.1.0",
        base,
        head,
        producer: { index: 1, total: 2 },
      });
      expect(readFileSync(lcovPath, "utf8")).toBe("SF:src/a.mts\nDA:2,0\nend_of_record\n");
      expect(manifest.patch.base).toBe(base);
      await expect(
        validatePatchCoverageContribution({
          root,
          lcovPath,
          manifestPath,
          descriptor,
          repository: "example/repo",
          revision: head,
          run: { id: "42", currentAttempt: 1 },
          base,
          head,
          expectedCollectorVersion: "4.1.0",
        }),
      ).resolves.toMatchObject({ version: 2, kind: "patch-lcov" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

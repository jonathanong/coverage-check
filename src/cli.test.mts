import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./cli.mts";

describe("cli subcommand dispatch", () => {
  let tmpDir: string;
  let rulesPath: string;
  let artifactsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cli-dispatch-"));
    rulesPath = join(tmpDir, "rules.yml");
    artifactsDir = join(tmpDir, "artifacts");
    mkdirSync(artifactsDir);
    writeFileSync(rulesPath, "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("defaults to check when no args given", async () => {
    // No args → check → no lcov files → returns 0
    expect(await main(["--rules", rulesPath, "--artifacts", artifactsDir])).toBe(0);
  });

  it("explicit check subcommand works", async () => {
    expect(await main(["check", "--rules", rulesPath, "--artifacts", artifactsDir])).toBe(0);
  });

  it("explicit store-put subcommand returns 2 when --store is missing", async () => {
    expect(await main(["store-put", "--suite", "backend"])).toBe(2);
  });

  it("returns 2 for unknown subcommand", async () => {
    expect(await main(["unknown-command"])).toBe(2);
  });

  it("flags-first argument (starting with --) goes to check", async () => {
    // '--rules' starts with '-', so dispatch goes to check
    expect(await main(["--rules", rulesPath, "--artifacts", artifactsDir])).toBe(0);
  });

  it("html subcommand returns 0 with no artifacts", async () => {
    const outputDir = join(tmpDir, "coverage-html");
    expect(
      await main(["html", "--artifacts", join(tmpDir, "nonexistent"), "--output", outputDir]),
    ).toBe(0);
  });

  it("summary subcommand returns 0 with no artifacts", async () => {
    expect(
      await main(["summary", "--artifacts", join(tmpDir, "nonexistent"), "--no-summary-file"]),
    ).toBe(0);
  });
});

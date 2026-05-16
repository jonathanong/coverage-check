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

  it("explicit store-put subcommand returns 2 when --suite is missing", async () => {
    expect(await main(["store-put", "--store", "/tmp/store"])).toBe(2);
  });

  it("returns 2 for unknown subcommand", async () => {
    expect(await main(["unknown-command"])).toBe(2);
  });

  it("flags-first argument (starting with --) goes to check", async () => {
    // '--rules' starts with '-', so dispatch goes to check
    expect(await main(["--rules", rulesPath, "--artifacts", artifactsDir])).toBe(0);
  });
});

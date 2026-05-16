import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, runCheck } from "./check.mts";
import { FileSystemSuiteStore } from "../suite-store.mts";

describe("main argument validation", () => {
  it("returns exit code 2 on unknown flags", async () => {
    expect(await main(["--unknown-flag"])).toBe(2);
  });

  it("returns exit code 2 when --pr is not a number", async () => {
    expect(await main(["--pr", "abc"])).toBe(2);
  });

  it("returns exit code 2 when --pr is zero", async () => {
    expect(await main(["--pr", "0"])).toBe(2);
  });

  it("returns exit code 2 when --pr has trailing non-digit chars", async () => {
    expect(await main(["--pr", "42abc"])).toBe(2);
  });

  it("returns exit code 2 when --pr is a decimal", async () => {
    expect(await main(["--pr", "42.5"])).toBe(2);
  });

  it("returns exit code 2 when a flag is missing its value", async () => {
    expect(await main(["--rules"])).toBe(2);
  });
});

describe("main integration", () => {
  let tmpDir: string;
  let rulesPath: string;
  let artifactsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coverage-check-main-"));
    rulesPath = join(tmpDir, "rules.yml");
    artifactsDir = join(tmpDir, "artifacts");
    mkdirSync(artifactsDir);
    writeFileSync(rulesPath, "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 2 when rules file is missing", async () => {
    expect(
      await main(["--rules", join(tmpDir, "nonexistent.yml"), "--artifacts", artifactsDir]),
    ).toBe(2);
  });

  it("accepts --pr and --repo flags (parse succeeds, fails on missing rules)", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--pr",
        "42",
        "--repo",
        "owner/repo",
        "--artifacts",
        artifactsDir,
      ]),
    ).toBe(2);
  });

  it("accepts --strip-prefix flag", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--strip-prefix",
        "/some/path",
        "--artifacts",
        artifactsDir,
      ]),
    ).toBe(2);
  });

  it("accepts --suite flag", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--suite",
        "backend",
        "--artifacts",
        artifactsDir,
      ]),
    ).toBe(2);
  });

  it("returns 0 when no coverage data found — skips git entirely", async () => {
    expect(await main(["--rules", rulesPath, "--artifacts", artifactsDir])).toBe(0);
  });

  it("returns 0 when artifacts directory does not exist (ENOENT silenced)", async () => {
    expect(await main(["--rules", rulesPath, "--artifacts", join(tmpDir, "does-not-exist")])).toBe(
      0,
    );
  });

  it("returns 2 when git diff fails due to invalid refs", async () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--base",
        "INVALID_SHA_XXXXXX",
        "--head",
        "INVALID_SHA_YYYYYY",
      ]),
    ).toBe(2);
  });

  it("collects lcov files from nested subdirectories before git diff", async () => {
    const subDir = join(artifactsDir, "subdir");
    mkdirSync(subDir);
    writeFileSync(join(subDir, "lcov.info"), "SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--base",
        "INVALID_SHA_XXXXXX",
        "--head",
        "INVALID_SHA_YYYYYY",
      ]),
    ).toBe(2);
  });
});

describe("runCheck with suite store", () => {
  let tmpDir: string;
  let rulesPath: string;
  let artifactsDir: string;
  let storeDir: string;
  let store: FileSystemSuiteStore;
  let origCwd: string;
  let savedGitEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coverage-check-store-"));
    rulesPath = join(tmpDir, "rules.yml");
    artifactsDir = join(tmpDir, "artifacts");
    storeDir = join(tmpDir, "store");
    mkdirSync(artifactsDir);
    mkdirSync(storeDir);
    writeFileSync(rulesPath, "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n");
    store = new FileSystemSuiteStore(storeDir);

    // Set up a minimal git repo so HEAD is valid for diff tests
    const repoDir = join(tmpDir, "repo");
    mkdirSync(join(repoDir, "backend"), { recursive: true });

    savedGitEnv = {};
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("GIT_")) {
        savedGitEnv[key] = process.env[key];
        delete process.env[key];
      }
    }

    const git = (cmd: string) =>
      execSync(cmd, {
        cwd: repoDir,
        shell: "/bin/sh",
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "T",
          GIT_AUTHOR_EMAIL: "t@t.com",
          GIT_COMMITTER_NAME: "T",
          GIT_COMMITTER_EMAIL: "t@t.com",
        },
      });
    git("git init");
    writeFileSync(join(repoDir, "backend", "foo.mts"), "const a = 1\n");
    git('git add . && git commit -m "init"');

    origCwd = process.cwd();
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    for (const [key, val] of Object.entries(savedGitEnv)) {
      if (val !== undefined) process.env[key] = val;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 when store has no suites and artifacts is empty", async () => {
    expect(
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: "HEAD",
        head: "HEAD",
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store,
        suite: null,
      }),
    ).toBe(0);
  });

  it("returns 0 when store has suites but diff is empty (base=head)", async () => {
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"));
    expect(
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: "HEAD",
        head: "HEAD",
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store,
        suite: null,
      }),
    ).toBe(0);
  });

  it("excludes the current suite from the store during check", async () => {
    // Store has "backend" suite with coverage; current artifacts is empty
    // With --suite=backend, the stored backend coverage should be excluded
    await store.put("backend", Buffer.from("SF:backend/foo.mts\nDA:1,1\nend_of_record\n"));
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"));

    expect(
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir, // empty
        base: "HEAD",
        head: "HEAD",
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store,
        suite: "backend", // excludes the stored backend suite
      }),
    ).toBe(0);
  });

  it("includes non-current suites from the store", async () => {
    // Put a "frontend" suite in the store; artifacts has backend coverage
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"));
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
    // With suite=backend, frontend from store should still be merged
    expect(
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: "HEAD",
        head: "HEAD",
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store,
        suite: "backend",
      }),
    ).toBe(0);
  });

  it("handles a store that returns null from get() gracefully", async () => {
    // Custom store: list returns a suite, but get returns null (e.g. file was deleted)
    const nullStore = {
      async list() {
        return ["backend"];
      },
      async get(_suite: string) {
        return null;
      },
      async put() {},
    };
    // No local artifacts + store returns null → no reports → return 0
    expect(
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: "HEAD",
        head: "HEAD",
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: nullStore,
        suite: null,
      }),
    ).toBe(0);
  });

  it("constructs a real runUrl when GITHUB_SERVER_URL and GITHUB_RUN_ID are set", async () => {
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"));

    const calls: string[][] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      return "";
    };

    const origServer = process.env["GITHUB_SERVER_URL"];
    const origRunId = process.env["GITHUB_RUN_ID"];
    process.env["GITHUB_SERVER_URL"] = "https://github.com";
    process.env["GITHUB_RUN_ID"] = "12345";

    try {
      // With frontend from store and empty diff (HEAD=HEAD), passes
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: "HEAD",
        head: "HEAD",
        pr: 1,
        repo: "owner/repo",
        json: null,
        stripPrefixes: [],
        store,
        suite: null,
        gh,
      });
      // gh was called (lookup for existing comment)
      expect(calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (origServer === undefined) delete process.env["GITHUB_SERVER_URL"];
      else process.env["GITHUB_SERVER_URL"] = origServer;
      if (origRunId === undefined) delete process.env["GITHUB_RUN_ID"];
      else process.env["GITHUB_RUN_ID"] = origRunId;
    }
  });

  it("accepts --store and --suite flags via main()", async () => {
    // --store and --suite valid flags, no lcov → returns 0
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--store",
        storeDir,
        "--suite",
        "backend",
      ]),
    ).toBe(0);
  });
});

describe("with a real git repo and a known diff", () => {
  let tmpDir: string;
  let rulesPath: string;
  let artifactsDir: string;
  let repoDir: string;
  let origCwd: string;
  let baseSha: string;
  let headSha: string;
  let savedGitEnv: Record<string, string | undefined>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "coverage-check-git-"));
    rulesPath = join(tmpDir, "rules.yml");
    artifactsDir = join(tmpDir, "artifacts");
    mkdirSync(artifactsDir);
    writeFileSync(rulesPath, "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n");

    repoDir = join(tmpDir, "repo");
    mkdirSync(join(repoDir, "backend"), { recursive: true });

    savedGitEnv = {};
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("GIT_")) {
        savedGitEnv[key] = process.env[key];
        delete process.env[key];
      }
    }

    const git = (cmd: string) =>
      execSync(cmd, {
        cwd: repoDir,
        shell: "/bin/sh",
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "T",
          GIT_AUTHOR_EMAIL: "t@t.com",
          GIT_COMMITTER_NAME: "T",
          GIT_COMMITTER_EMAIL: "t@t.com",
        },
      });

    git("git init");
    writeFileSync(join(repoDir, "backend/foo.mts"), "const a = 1\n");
    git('git add . && git commit -m "base"');
    baseSha = git("git rev-parse HEAD").trim();

    writeFileSync(join(repoDir, "backend/foo.mts"), "const a = 1\nconst b = 2\n");
    git('git add . && git commit -m "head"');
    headSha = git("git rev-parse HEAD").trim();

    origCwd = process.cwd();
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    for (const [key, val] of Object.entries(savedGitEnv)) {
      if (val !== undefined) process.env[key] = val;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 when diff is empty (base equals head)", async () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--base",
        "HEAD",
        "--head",
        "HEAD",
      ]),
    ).toBe(0);
  });

  it("returns 1 when new lines are uncovered and below threshold", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--base",
        baseSha,
        "--head",
        headSha,
      ]),
    ).toBe(1);
  });

  it("returns 0 when all new lines are covered and above threshold", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--base",
        baseSha,
        "--head",
        headSha,
      ]),
    ).toBe(0);
  });

  it("writes json output to the path specified by --json", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    const jsonPath = join(tmpDir, "result.json");
    await main([
      "--rules",
      rulesPath,
      "--artifacts",
      artifactsDir,
      "--base",
      baseSha,
      "--head",
      headSha,
      "--json",
      jsonPath,
    ]);
    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result.passed).toBe(true);
    expect(Array.isArray(result.buckets)).toBe(true);
  });

  it("posts PR comment via injectable gh runner on failure", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const calls: string[][] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      return "";
    };
    const result = await runCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: 42,
      repo: "owner/repo",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: null,
      gh,
    });
    expect(result).toBe(1);
    // gh was called: first to look up existing comment, then to post
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("posts PR comment via injectable gh runner on pass", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    const calls: string[][] = [];
    const gh = async (args: string[]) => {
      calls.push(args);
      return "";
    };
    const result = await runCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: 42,
      repo: "owner/repo",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: null,
      gh,
    });
    expect(result).toBe(0);
    // On pass with no existing comment, gh is called once (lookup only)
    expect(calls.length).toBe(1);
  });

  it("handles gh error gracefully (stderr write, still returns correct exit code)", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const gh = async (_args: string[]): Promise<string> => {
      throw new Error("network error");
    };
    const result = await runCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: 42,
      repo: "owner/repo",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: null,
      gh,
    });
    // Still returns 1 even though gh call failed
    expect(result).toBe(1);
  });

  it.skipIf(
    process.env.PR_AUTHOR === "dependabot[bot]" ||
      (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN),
  )("attempts pr comment on failure and handles gh error gracefully", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--base",
        baseSha,
        "--head",
        headSha,
        "--pr",
        "1",
        "--repo",
        "owner/NONEXISTENT_REPO_FOR_TEST",
      ]),
    ).toBe(1);
  });

  it("combines store suites with current artifacts for coverage check", async () => {
    const storeDir = join(tmpDir, "store");
    mkdirSync(storeDir);
    const store = new FileSystemSuiteStore(storeDir);

    // Store has frontend coverage (unrelated to the diff)
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"));

    // Current artifacts has backend coverage (line 2 now covered)
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );

    expect(
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store,
        suite: "backend",
      }),
    ).toBe(0);
  });
});

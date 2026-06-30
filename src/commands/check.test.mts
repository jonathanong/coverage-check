import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCheckArgs } from "./check-args.mts";
import { checkCoverage, evaluateCheck, main, runCheck } from "./check.mts";
import { FileSystemSuiteStore } from "../suite-store.mts";

describe("main argument validation", () => {
  it("returns 0 and prints help for --help", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await main(["--help"])).toBe(0);
      const output = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(output).toContain("coverage-check check");
      expect(output).toContain("--advisory");
      expect(output).toContain("--json <path|->");
    } finally {
      writeSpy.mockRestore();
    }
  });

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

  it("returns exit code 2 when a flag token follows as the value (e.g. --rules --pr)", async () => {
    expect(await main(["--rules", "--pr"])).toBe(2);
  });

  it("returns exit code 2 when --pr is set but repo is empty", async () => {
    const saved = process.env["GITHUB_REPOSITORY"];
    delete process.env["GITHUB_REPOSITORY"];
    try {
      expect(await main(["--pr", "42"])).toBe(2);
    } finally {
      if (saved !== undefined) process.env["GITHUB_REPOSITORY"] = saved;
      else delete process.env["GITHUB_REPOSITORY"];
    }
  });

  it("returns exit code 2 when --pr is set and repo format is invalid", async () => {
    const saved = process.env["GITHUB_REPOSITORY"];
    delete process.env["GITHUB_REPOSITORY"];
    try {
      expect(await main(["--pr", "42", "--repo", "-invalid/repo"])).toBe(2);
      expect(await main(["--pr", "42", "--repo", "owner-without-slash-repo"])).toBe(2);
      expect(await main(["--pr", "42", "--repo", "owner/."])).toBe(2);
      expect(await main(["--pr", "42", "--repo", "owner/.."])).toBe(2);
    } finally {
      if (saved !== undefined) process.env["GITHUB_REPOSITORY"] = saved;
      else delete process.env["GITHUB_REPOSITORY"];
    }
  });

  it("trims repository input before validation", async () => {
    expect(
      await main([
        "--rules",
        "/tmp/does-not-exist.yml",
        "--artifacts",
        "/tmp",
        "--pr",
        "42",
        "--repo",
        " owner/repo ",
      ]),
    ).toBe(2);
  });

  it("allows an empty repo when no PR is being commented", () => {
    const saved = process.env["GITHUB_REPOSITORY"];
    delete process.env["GITHUB_REPOSITORY"];
    try {
      expect(parseCheckArgs([]).repo).toBe("");
    } finally {
      if (saved !== undefined) process.env["GITHUB_REPOSITORY"] = saved;
      else delete process.env["GITHUB_REPOSITORY"];
    }
  });

  it("uses fallback defaults when GITHUB_REPOSITORY/REF_NAME/STEP_SUMMARY are unset", async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of ["GITHUB_REPOSITORY", "GITHUB_REF_NAME", "GITHUB_STEP_SUMMARY"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      // Any call exercises the default-init lines; unknown flag triggers parse error
      expect(await main(["--unknown-flag"])).toBe(2);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v !== undefined) process.env[k] = v;
        else delete process.env[k];
      }
    }
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

  it("accepts repo names with leading hyphen in the repository segment", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--pr",
        "42",
        "--repo",
        "owner/-repo",
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

  it("accepts --annotate-source flag", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--annotate-source",
        "--artifacts",
        artifactsDir,
      ]),
    ).toBe(2);
  });

  it("accepts --drop-only-changed-areas flag (parse succeeds, fails on missing rules)", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--drop-only-changed-areas",
        "--artifacts",
        artifactsDir,
      ]),
    ).toBe(2);
  });

  it("accepts --aggregate-artifacts and --ignore-path flags", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--aggregate-artifacts",
        "--ignore-path",
        "backend/generated/**",
        "--artifacts",
        artifactsDir,
      ]),
    ).toBe(2);
  });

  it("accepts --branch flag with a real branch name", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--branch",
        "feature/foo",
        "--artifacts",
        artifactsDir,
      ]),
    ).toBe(2);
  });

  it("returns 2 when --branch is empty", async () => {
    expect(await main(["--branch", "", "--artifacts", artifactsDir])).toBe(2);
  });

  it("returns 2 when both --store-fs and --store-s3 are provided", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--artifacts",
        artifactsDir,
        "--store-fs",
        "/tmp/store",
        "--store-s3",
        "my-bucket",
      ]),
    ).toBe(2);
  });

  it("accepts --store-s3 flag (parse succeeds, fails on missing rules)", async () => {
    expect(
      await main([
        "--rules",
        join(tmpDir, "nonexistent.yml"),
        "--artifacts",
        artifactsDir,
        "--store-s3",
        "my-bucket/prefix",
      ]),
    ).toBe(2);
  });

  it("returns 0 when no coverage data found — skips git entirely", async () => {
    expect(await main(["--rules", rulesPath, "--artifacts", artifactsDir])).toBe(0);
  });

  it("writes skipped JSON when no coverage data is found", async () => {
    const jsonPath = join(tmpDir, "no-coverage-result.json");

    expect(
      await main(["--rules", rulesPath, "--artifacts", artifactsDir, "--json", jsonPath]),
    ).toBe(0);

    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result).toEqual({
      buckets: [],
      drops: [],
      informational: [],
      passed: true,
      exitCode: 0,
      advisory: false,
      skipped: true,
    });
  });

  it("returns 1 when --fail-on-empty is set and no coverage data is found", async () => {
    expect(await main(["--rules", rulesPath, "--artifacts", artifactsDir, "--fail-on-empty"])).toBe(
      1,
    );
  });

  it("writes error JSON when --fail-on-empty finds no coverage data", async () => {
    const jsonPath = join(tmpDir, "fail-on-empty-result.json");

    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--fail-on-empty",
        "--json",
        jsonPath,
      ]),
    ).toBe(1);

    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.advisory).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toContain("no coverage data found under");
  });

  it("returns 2 when a required artifact is missing", async () => {
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--require-artifact",
        "coverage-missing/lcov.info",
      ]),
    ).toBe(2);
  });

  it("writes error JSON when a required artifact is missing", async () => {
    const jsonPath = join(tmpDir, "missing-artifact-result.json");

    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--require-artifact",
        "coverage-missing/lcov.info",
        "--json",
        jsonPath,
      ]),
    ).toBe(2);

    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.skipped).toBe(false);
    expect(result.error).toBe("missing required coverage artifact");
  });

  it("prints missing required artifacts through runCheck", async () => {
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    });

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
        store: null,
        suite: null,
        requireArtifacts: ["coverage-missing/lcov.info"],
      }),
    ).toBe(2);
    expect(errors.join("")).toContain(
      "::error:: missing expected coverage artifact: coverage-missing/lcov.info",
    );
  });

  it("passes --require-artifact when the file exists", async () => {
    const suiteDir = join(artifactsDir, "coverage-backend");
    mkdirSync(suiteDir);
    // Use a non-lcov.info filename so collectLcovFiles ignores it; the artifacts
    // dir stays empty → reports.length === 0 → returns 0 without running git diff.
    writeFileSync(join(suiteDir, "exists.marker"), "");
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--require-artifact",
        "coverage-backend/exists.marker",
      ]),
    ).toBe(0); // no lcov.info files found → skips git entirely
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
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"), {
      sha: "test-sha",
      branch: "main",
    });
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
    await store.put("backend", Buffer.from("SF:backend/foo.mts\nDA:1,1\nend_of_record\n"), {
      sha: "test-sha",
      branch: "main",
    });
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"), {
      sha: "test-sha",
      branch: "main",
    });
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

  it("includes non-current suites from the store", async () => {
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"), {
      sha: "test-sha",
      branch: "main",
    });
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:1,1\nend_of_record\n");
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

  it("evaluateCheck returns structured JSON-equivalent results without writing a file", async () => {
    writeFileSync(join(process.cwd(), "backend", "foo.mts"), "const a = 1\nconst b = 2\n");
    execSync('git add . && git commit -m "change"', {
      cwd: process.cwd(),
      shell: "/bin/sh",
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@t.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@t.com",
      },
    });
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:2,0\nend_of_record\n");

    const evaluated = await evaluateCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: "HEAD~1",
      head: "HEAD",
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store,
      suite: "backend",
    });

    expect(evaluated.exitCode).toBe(1);
    expect(evaluated.result?.passed).toBe(false);
    expect(evaluated.result?.buckets[0]?.files[0]?.uncoveredLines).toEqual([2]);
  });

  it("--ignore-path prepends a zero-threshold override for matching changed files", async () => {
    writeFileSync(join(process.cwd(), "backend", "foo.mts"), "const a = 1\nconst b = 2\n");
    execSync('git add . && git commit -m "change"', {
      cwd: process.cwd(),
      shell: "/bin/sh",
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@t.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@t.com",
      },
    });
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:2,0\nend_of_record\n");

    const evaluated = await evaluateCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: "HEAD~1",
      head: "HEAD",
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store,
      suite: "backend",
      ignorePaths: ["backend/**"],
    });

    expect(evaluated.exitCode).toBe(0);
    expect(evaluated.result?.passed).toBe(true);
    expect(evaluated.result?.buckets[0]?.threshold).toBe(0);
  });

  it("--aggregate-artifacts warns once for non-contributing fresh fan-in artifacts", async () => {
    mkdirSync(join(artifactsDir, "coverage-a"));
    mkdirSync(join(artifactsDir, "coverage-b"));
    writeFileSync(
      join(artifactsDir, "coverage-a", "lcov.info"),
      "SF:other/a.mts\nDA:1,1\nend_of_record\n",
    );
    writeFileSync(
      join(artifactsDir, "coverage-b", "lcov.info"),
      "SF:other/b.mts\nDA:1,1\nend_of_record\n",
    );
    writeFileSync(join(process.cwd(), "backend", "foo.mts"), "const a = 1\nconst b = 2\n");
    execSync('git add . && git commit -m "change"', {
      cwd: process.cwd(),
      shell: "/bin/sh",
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@t.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@t.com",
      },
    });

    const unaggregated = await evaluateCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: "HEAD~1",
      head: "HEAD",
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store,
      suite: "backend",
    });
    const aggregated = await evaluateCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: "HEAD~1",
      head: "HEAD",
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store,
      suite: "backend",
      aggregateArtifacts: true,
    });

    expect(unaggregated.warnings).toHaveLength(2);
    expect(aggregated.warnings).toHaveLength(1);
    expect(aggregated.warnings[0]).toContain("aggregated artifacts");
  });

  it("handles a store that returns null from get() gracefully", async () => {
    const nullStore = {
      async list() {
        return ["backend"];
      },
      async get(_suite: string, _opts?: { sha?: string; branch?: string }) {
        return null;
      },
      async put(
        _suite: string,
        _lcov: Buffer,
        _meta: { sha: string; branch: string },
      ): Promise<void> {},
    };
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
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"), {
      sha: "test-sha",
      branch: "main",
    });

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
      expect(calls.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (origServer === undefined) delete process.env["GITHUB_SERVER_URL"];
      else process.env["GITHUB_SERVER_URL"] = origServer;
      if (origRunId === undefined) delete process.env["GITHUB_RUN_ID"];
      else process.env["GITHUB_RUN_ID"] = origRunId;
    }
  });

  it("accepts --store and --suite flags via main()", async () => {
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

  it("accepts --store-fs flag as alias for --store", async () => {
    expect(
      await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--store-fs",
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

    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"), {
      sha: "test-sha",
      branch: "main",
    });

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

  it("writes step summary when summaryFile is provided", async () => {
    const summaryFile = join(tmpDir, "summary.md");
    writeFileSync(summaryFile, "");
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    await runCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: "backend",
      summaryFile,
    });
    const content = readFileSync(summaryFile, "utf8");
    expect(content).toContain("Coverage summary");
  });

  it("does not write step summary when summaryFile is null even if env var is set", async () => {
    const summaryFile = join(tmpDir, "should-not-exist.md");
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    const origEnv = process.env["GITHUB_STEP_SUMMARY"];
    process.env["GITHUB_STEP_SUMMARY"] = summaryFile;
    try {
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: null,
        suite: "backend",
        summaryFile: null,
      });
    } finally {
      if (origEnv === undefined) delete process.env["GITHUB_STEP_SUMMARY"];
      else process.env["GITHUB_STEP_SUMMARY"] = origEnv;
    }
    expect(() => readFileSync(summaryFile, "utf8")).toThrow();
  });

  it("uses N/A runUrl when GITHUB_SERVER_URL and GITHUB_RUN_ID are unset", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    const savedServer = process.env["GITHUB_SERVER_URL"];
    const savedRunId = process.env["GITHUB_RUN_ID"];
    delete process.env["GITHUB_SERVER_URL"];
    delete process.env["GITHUB_RUN_ID"];
    try {
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: null,
        suite: "backend",
      });
    } finally {
      if (savedServer !== undefined) process.env["GITHUB_SERVER_URL"] = savedServer;
      else delete process.env["GITHUB_SERVER_URL"];
      if (savedRunId !== undefined) process.env["GITHUB_RUN_ID"] = savedRunId;
      else delete process.env["GITHUB_RUN_ID"];
    }
  });

  it("returns 2 when writeSummary throws (unwritable summaryFile path)", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    // Pass the tmp directory itself as summaryFile — appendFileSync on a dir throws EISDIR
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
        store: null,
        suite: "backend",
        summaryFile: tmpDir,
      }),
    ).toBe(2);
  });

  it("does not write summary when summaryFile is undefined and GITHUB_STEP_SUMMARY is unset", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    const savedSummary = process.env["GITHUB_STEP_SUMMARY"];
    delete process.env["GITHUB_STEP_SUMMARY"];
    try {
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: null,
        suite: "backend",
        summaryFile: undefined,
      });
    } finally {
      if (savedSummary !== undefined) process.env["GITHUB_STEP_SUMMARY"] = savedSummary;
      else delete process.env["GITHUB_STEP_SUMMARY"];
    }
  });

  it("logs a warning when an LCOV source contributes 0 coverable lines to a non-empty patch", async () => {
    // This LCOV file matches nothing in the diff (which is backend/foo.mts)
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:other/file.mts\nDA:1,1\nend_of_record\n");

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: null,
        suite: null,
      });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("warning: coverage from file"));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("contributed 0 coverable lines"));
    } finally {
      spy.mockRestore();
    }
  });

  it("logs a warning when a file matches but no lines match (branch coverage)", async () => {
    // SF matches backend/foo.mts, but line 100 is not in the diff (which is lines 1 and 2)
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:100,1\nend_of_record\n");

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: null,
        suite: null,
      });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("warning: coverage from file"));
    } finally {
      spy.mockRestore();
    }
  });

  it("does not log a warning when at least one line matches", async () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:2,1\nend_of_record\n");

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: null,
        suite: null,
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("logs warnings for multiple sources independently", async () => {
    const storeDir = join(tmpDir, "store2");
    mkdirSync(storeDir);
    const store = new FileSystemSuiteStore(storeDir);
    // suite 'frontend' matches nothing
    await store.put("frontend", Buffer.from("SF:web/app.tsx\nDA:1,1\nend_of_record\n"), {
      sha: "test-sha",
      branch: "main",
    });

    // file 'lcov.info' matches nothing
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:other/file.mts\nDA:1,1\nend_of_record\n");

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
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
        suite: null,
      });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("warning: coverage from suite"));
      expect(spy).toHaveBeenCalledWith(expect.stringContaining("warning: coverage from file"));
    } finally {
      spy.mockRestore();
    }
  });

  it("annotates uncovered lines with source text when annotateSource is true", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const stdoutLines: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdoutLines.push(String(chunk));
      return true;
    });
    try {
      const result = await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: null,
        suite: null,
        annotateSource: true,
      });
      expect(result).toBe(1);
      const output = stdoutLines.join("");
      expect(output).toContain("backend/foo.mts:");
      expect(output).toContain("L2  const b = 2");
    } finally {
      spy.mockRestore();
    }
  });

  it("stops checking a source once contribution is found (loop break coverage)", async () => {
    // This LCOV file matches the first file in the diff
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:2,1\nend_of_record\n");

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await runCheck({
        rules: rulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: null,
        stripPrefixes: [],
        store: null,
        suite: null,
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("sets contributes=true when a line matches (statement coverage)", async () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/foo.mts\nDA:2,1\nend_of_record\n");
    const result = await runCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: null,
    });
    expect(result).toBe(0);
  });

  it("skips suites that return null from store.get (branch coverage)", async () => {
    const storeDir = join(tmpDir, "store3");
    mkdirSync(storeDir);
    const store = new FileSystemSuiteStore(storeDir);
    // Add a suite but then delete the file to make get() return null (or just mock if easier, but let's try real)
    await store.put("missing", Buffer.from("SF:foo.mts\nDA:1,1\nend_of_record\n"), {
      sha: "sha",
      branch: "main",
    });
    rmSync(join(storeDir, "missing", "main.lcov"), { force: true });

    const result = await runCheck({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store,
      suite: null,
    });
    expect(result).toBe(0);
  });

  it("drops are all skipped when no store is configured", async () => {
    const noDropRulesPath = join(tmpDir, "rules-drop.yml");
    writeFileSync(
      noDropRulesPath,
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    no_coverage_drop: true\n",
    );
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    const jsonPath = join(tmpDir, "result-drop-skipped.json");
    const exitCode = await runCheck({
      rules: noDropRulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: jsonPath,
      stripPrefixes: [],
      store: null,
      suite: null,
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].skipped).toBe(true);
    expect(result.drops[0].passed).toBe(true);
  });

  it("drops pass when baseline coverage equals current", async () => {
    const dropRulesPath = join(tmpDir, "rules-drop2.yml");
    writeFileSync(
      dropRulesPath,
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    no_coverage_drop: true\n",
    );
    const storeDir2 = join(tmpDir, "store-drop");
    mkdirSync(storeDir2);
    const store2 = new FileSystemSuiteStore(storeDir2);
    await store2.put(
      "backend",
      Buffer.from("SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n"),
      { sha: "sha", branch: "main" },
    );
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    const jsonPath = join(tmpDir, "result-drop-pass.json");
    const exitCode = await runCheck({
      rules: dropRulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: jsonPath,
      stripPrefixes: [],
      store: store2,
      suite: null,
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].passed).toBe(true);
    expect(result.drops[0].skipped).toBe(false);
  });

  it("returns exit code 1 and includes failing drop in JSON when baseline is higher than current", async () => {
    const dropRulesPath = join(tmpDir, "rules-drop3.yml");
    writeFileSync(
      dropRulesPath,
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 0\n    no_coverage_drop: true\n",
    );
    const storeDir3 = join(tmpDir, "store-drop3");
    mkdirSync(storeDir3);
    const store3 = new FileSystemSuiteStore(storeDir3);
    // Baseline stored under suite "backend-baseline" (excluded from current run via suite param).
    // backend/bar.mts has 4/4 lines covered in baseline.
    await store3.put(
      "backend-baseline",
      Buffer.from("SF:backend/foo.mts\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n"),
      { sha: "sha", branch: "main" },
    );
    // Fresh artifacts: only 1/4 lines covered — regression vs baseline.
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nDA:3,0\nDA:4,0\nend_of_record\n",
    );
    const jsonPath = join(tmpDir, "result-drop-fail.json");
    // Use suite: "current" so "backend-baseline" is NOT excluded and is included in both
    // reports (merged lcov) and baseline. But the fresh artifact drives down coverage when
    // merged with the baseline store data... actually we need a store suite that is excluded
    // from current but counts in baseline. Use suite: "backend-baseline" to exclude it from
    // reports[] so only fresh artifacts form the current lcov.
    const exitCode = await runCheck({
      rules: dropRulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: jsonPath,
      stripPrefixes: [],
      store: store3,
      suite: "backend-baseline",
    });
    expect(exitCode).toBe(1);
    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].passed).toBe(false);
    expect(result.drops[0].skipped).toBe(false);
    expect(result.drops[0].drop).toBeGreaterThan(0);
  });

  it("baseline stays null when store has suites but all get() return null", async () => {
    // This test covers the false branches at check.mts lines 110 and 114:
    // - `if (buf !== null)` false branch (buf === null from store.get in baseline loop)
    // - `if (baselineReports.length > 0)` false branch (no baseline data → stays null)
    const dropRulesPath = join(tmpDir, "rules-drop-null-store.yml");
    writeFileSync(
      dropRulesPath,
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    no_coverage_drop: true\n",
    );
    // Provide artifact data so reports.length > 0 (prevents early return before baseline loop)
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    const nullStore = {
      async list() {
        return ["suite-a"];
      },
      async get(_suite: string, _opts?: { sha?: string; branch?: string }): Promise<Buffer | null> {
        return null;
      },
      async put(): Promise<void> {},
    };
    const jsonPath = join(tmpDir, "result-null-baseline.json");
    const exitCode = await runCheck({
      rules: dropRulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: jsonPath,
      stripPrefixes: [],
      store: nullStore,
      suite: null,
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    // Drop is skipped because baseline is null (store returned null for all suites)
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].skipped).toBe(true);
    expect(result.drops[0].passed).toBe(true);
  });

  it("--advisory: returns 0 even when patch coverage is below threshold", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    // Without --advisory this would be exit 1 (uncovered line 2)
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
        "--advisory",
      ]),
    ).toBe(0);
  });

  it("checkCoverage returns structured results and the intended failing exit code", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const check = await checkCoverage({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: null,
    });
    expect(check.exitCode).toBe(1);
    expect(check.advisory).toBe(false);
    expect(check.skipped).toBe(false);
    expect(check.error).toBeNull();
    expect(check.result?.passed).toBe(false);
  });

  it("checkCoverage returns exit code 0 for advisory failures while preserving failed result", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const check = await checkCoverage({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: null,
      advisory: true,
    });
    expect(check.exitCode).toBe(0);
    expect(check.advisory).toBe(true);
    expect(check.result?.passed).toBe(false);
  });

  it("checkCoverage returns a structured skipped result when no coverage data is found", async () => {
    const check = await checkCoverage({
      rules: rulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: null,
    });
    expect(check.exitCode).toBe(0);
    expect(check.skipped).toBe(true);
    expect(check.result).toEqual({ buckets: [], drops: [], informational: [], passed: true });
    expect(check.warnings.join("\n")).toContain("no coverage data found");
  });

  it("checkCoverage returns structured config errors", async () => {
    const check = await checkCoverage({
      rules: join(tmpDir, "missing.yml"),
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store: null,
      suite: null,
    });
    expect(check.exitCode).toBe(2);
    expect(check.result).toBeNull();
    expect(check.error).toContain("failed to load rules");
  });

  it("--advisory still writes JSON output on failure", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const jsonPath = join(tmpDir, "advisory-result.json");
    await main([
      "--rules",
      rulesPath,
      "--artifacts",
      artifactsDir,
      "--base",
      baseSha,
      "--head",
      headSha,
      "--advisory",
      "--json",
      jsonPath,
    ]);
    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result.passed).toBe(false); // content reflects real result
    expect(result.exitCode).toBe(0);
    expect(result.advisory).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it("--json - writes parseable JSON to stdout without human output", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const stdoutChunks: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
    try {
      const exitCode = await main([
        "--rules",
        rulesPath,
        "--artifacts",
        artifactsDir,
        "--base",
        baseSha,
        "--head",
        headSha,
        "--json",
        "-",
      ]);
      expect(exitCode).toBe(1);
      const output = stdoutChunks.join("");
      expect(output).not.toContain("coverage-check: FAILED");
      const result = JSON.parse(output);
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.advisory).toBe(false);
      expect(result.skipped).toBe(false);
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("--drop-only-changed-areas skips drop rules when their area has no diff changes", async () => {
    const dropRulesPath = join(tmpDir, "rules-drop-changed.yml");
    writeFileSync(
      dropRulesPath,
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 0\n    no_coverage_drop: true\n",
    );
    const storeDir2 = join(tmpDir, "store-changed");
    mkdirSync(storeDir2);
    const store2 = new FileSystemSuiteStore(storeDir2);
    // Baseline: 100% coverage for backend/**
    await store2.put("main", Buffer.from("SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n"), {
      sha: "sha1",
      branch: "main",
    });
    // Fresh artifacts: regression (50%) — would normally fail
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    const jsonPath = join(tmpDir, "result-drop-changed.json");

    // Without flag, regression is detected and fails.
    // Use suite: "main" so the store suite is excluded from current run; fresh artifact is 50%.
    const exitWithout = await runCheck({
      rules: dropRulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: baseSha, // empty diff — no backend files changed
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store: store2,
      suite: "main", // exclude "main" from current so fresh artifact = 50% < baseline 100%
    });
    expect(exitWithout).toBe(1); // drop regression detected

    // With flag, drop is skipped because no backend files are in the (empty) diff
    const exitWith = await runCheck({
      rules: dropRulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: baseSha, // empty diff
      pr: null,
      repo: "",
      json: jsonPath,
      stripPrefixes: [],
      store: store2,
      suite: "main",
      dropOnlyChangedAreas: true,
    });
    expect(exitWith).toBe(0);
    const result = JSON.parse(readFileSync(jsonPath, "utf8"));
    expect(result.drops).toHaveLength(1);
    expect(result.drops[0].skipped).toBe(true);
  });

  it("--drop-only-changed-areas still applies drop gate when area has diff changes", async () => {
    const dropRulesPath = join(tmpDir, "rules-drop-changed2.yml");
    writeFileSync(
      dropRulesPath,
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 0\n    no_coverage_drop: true\n",
    );
    const storeDir3 = join(tmpDir, "store-changed2");
    mkdirSync(storeDir3);
    const store3 = new FileSystemSuiteStore(storeDir3);
    // Baseline: 100%
    await store3.put("main", Buffer.from("SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n"), {
      sha: "sha1",
      branch: "main",
    });
    // Regression: 50%
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );
    // baseSha → headSha touches backend/foo.mts, so backend/** IS in changedRules.
    // Use suite: "main" so the store baseline is excluded from current run; fresh artifact is 50%.
    const exitCode = await runCheck({
      rules: dropRulesPath,
      artifacts: artifactsDir,
      base: baseSha,
      head: headSha,
      pr: null,
      repo: "",
      json: null,
      stripPrefixes: [],
      store: store3,
      suite: "main", // exclude "main" from current so fresh artifact = 50% < baseline 100%
      dropOnlyChangedAreas: true,
    });
    expect(exitCode).toBe(1); // drop still fails because backend/** was changed
  });

  it("logs a warning and skips the drop check when the store throws during baseline loading", async () => {
    // Covers the catch block in check.mts: store.list() succeeds (returns []) on the first
    // call (current-suite loop is a no-op), then throws on the second call (baseline loop).
    const dropRulesPath = join(tmpDir, "rules-drop-throw-store.yml");
    writeFileSync(
      dropRulesPath,
      "rules:\n  - paths: backend/**\n    patch_coverage_min: 90\n    no_coverage_drop: true\n",
    );
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,1\nend_of_record\n",
    );
    let listCallCount = 0;
    const throwingStore = {
      async list() {
        listCallCount++;
        if (listCallCount >= 2) throw new Error("simulated store network error");
        return [];
      },
      async get(_suite: string, _opts?: { sha?: string; branch?: string }): Promise<Buffer | null> {
        return null;
      },
      async put(): Promise<void> {},
    };
    const stderrLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderrLines.push(String(chunk));
      return true;
    });
    try {
      const jsonPath = join(tmpDir, "result-throw-baseline.json");
      const exitCode = await runCheck({
        rules: dropRulesPath,
        artifacts: artifactsDir,
        base: baseSha,
        head: headSha,
        pr: null,
        repo: "",
        json: jsonPath,
        stripPrefixes: [],
        store: throwingStore,
        suite: null,
      });
      expect(exitCode).toBe(0);
      expect(stderrLines.some((l) => l.includes("failed to load baseline from store"))).toBe(true);
      const result = JSON.parse(readFileSync(jsonPath, "utf8"));
      // Drop is skipped because the try-catch caught the store error → baseline stays null
      expect(result.drops).toHaveLength(1);
      expect(result.drops[0].skipped).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });
});

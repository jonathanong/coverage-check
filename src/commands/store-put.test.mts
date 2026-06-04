import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, runStorePut } from "./store-put.mts";
import { FileSystemSuiteStore } from "../suite-store.mts";

describe("main argument parsing", () => {
  it("returns 2 when --store is missing", async () => {
    expect(await main(["--suite", "backend", "--sha", "abc", "--branch", "main"])).toBe(2);
  });

  it("returns 2 when only one of --sha and --branch is provided", async () => {
    expect(await main(["--suite", "backend", "--store", "/tmp/s", "--branch", "main"])).toBe(2);
    expect(await main(["--suite", "backend", "--store", "/tmp/s", "--sha", "abc"])).toBe(2);
  });

  it("returns 2 when sha or branch metadata is empty", async () => {
    expect(
      await main(["--suite", "backend", "--store", "/tmp/s", "--sha", "", "--branch", "main"]),
    ).toBe(2);
    expect(
      await main(["--suite", "backend", "--store", "/tmp/s", "--sha", "abc", "--branch", ""]),
    ).toBe(2);
  });

  it("returns 2 when a flag token follows as the value (e.g. --suite --store)", async () => {
    expect(await main(["--suite", "--store"])).toBe(2);
  });

  it("accepts --store-s3 flag (returns 0 when no lcov files, not unknown-flag error)", async () => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      chunks.push(String(c));
      return true;
    });
    try {
      expect(
        await main([
          "--suite",
          "backend",
          "--store-s3",
          "my-bucket/prefix",
          "--sha",
          "abc",
          "--branch",
          "main",
          "--artifacts",
          "/tmp/__nonexistent_dir__",
        ]),
      ).toBe(0);
      const out = chunks.join("");
      expect(out).toContain("skipping suite");
      expect(out).not.toContain("unknown flag");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("returns 2 when both --store-fs and --store-s3 are provided", async () => {
    expect(
      await main([
        "--suite",
        "backend",
        "--store-fs",
        "/tmp/s",
        "--store-s3",
        "bucket",
        "--sha",
        "abc",
        "--branch",
        "main",
      ]),
    ).toBe(2);
  });

  it("returns 2 on unknown flag", async () => {
    expect(
      await main([
        "--suite",
        "backend",
        "--store",
        "/tmp/s",
        "--sha",
        "abc",
        "--branch",
        "main",
        "--unknown",
      ]),
    ).toBe(2);
  });

  it("returns 2 when --sha starts with -", async () => {
    expect(
      await main(["--suite", "backend", "--store-fs", "/tmp", "--sha", "-abc", "--branch", "main"]),
    ).toBe(2);
  });

  it("returns 2 when --branch starts with -", async () => {
    expect(
      await main(["--suite", "backend", "--store-fs", "/tmp", "--sha", "abc", "--branch", "-main"]),
    ).toBe(2);
  });

  it("returns 2 when a flag is missing its value", async () => {
    expect(await main(["--suite"])).toBe(2);
  });
});

describe("runStorePut", () => {
  let tmpDir: string;
  let artifactsDir: string;
  let storeDir: string;
  let store: FileSystemSuiteStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "store-put-test-"));
    artifactsDir = join(tmpDir, "artifacts");
    storeDir = join(tmpDir, "store");
    mkdirSync(artifactsDir);
    mkdirSync(storeDir);
    store = new FileSystemSuiteStore(storeDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 0 when no lcov.info files found in artifacts (skip)", async () => {
    expect(
      await runStorePut({
        suite: "backend",
        suitePrefix: "coverage-",
        store,
        artifacts: artifactsDir,
        stripPrefixes: [],
        sha: "abc123",
        branch: "main",
      }),
    ).toBe(0);
  });

  it("stores merged lcov from artifacts and returns 0", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:backend/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n",
    );

    expect(
      await runStorePut({
        suite: "backend",
        suitePrefix: "coverage-",
        store,
        artifacts: artifactsDir,
        stripPrefixes: [],
        sha: "abc123",
        branch: "main",
      }),
    ).toBe(0);

    const suites = await store.list();
    expect(suites).toContain("backend");

    const buf = await store.get("backend", { branch: "main" });
    expect(buf).not.toBeNull();
    const lcovText = buf!.toString();
    expect(lcovText).toContain("SF:backend/foo.mts");
    expect(lcovText).toContain("DA:1,1");
  });

  it("merges multiple lcov files from nested subdirectories", async () => {
    const sub = join(artifactsDir, "shard1");
    mkdirSync(sub);
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:backend/a.mts\nDA:1,1\nend_of_record\n");
    writeFileSync(join(sub, "lcov.info"), "SF:backend/b.mts\nDA:2,1\nend_of_record\n");

    expect(
      await runStorePut({
        suite: "backend",
        suitePrefix: "coverage-",
        store,
        artifacts: artifactsDir,
        stripPrefixes: [],
        sha: "abc123",
        branch: "main",
      }),
    ).toBe(0);

    const buf = await store.get("backend", { branch: "main" });
    const lcovText = buf!.toString();
    expect(lcovText).toContain("SF:backend/a.mts");
    expect(lcovText).toContain("SF:backend/b.mts");
  });

  it("accepts --strip-prefix flag via main()", async () => {
    writeFileSync(
      join(artifactsDir, "lcov.info"),
      "SF:/home/runner/work/repo/backend/foo.mts\nDA:1,1\nend_of_record\n",
    );

    expect(
      await main([
        "--suite",
        "backend",
        "--store",
        storeDir,
        "--artifacts",
        artifactsDir,
        "--strip-prefix",
        "/home/runner/work/repo",
        "--sha",
        "abc123",
        "--branch",
        "main",
      ]),
    ).toBe(0);

    const buf = await store.get("backend", { branch: "main" });
    expect(buf!.toString()).toContain("SF:backend/foo.mts");
  });

  it("--store-fs is an alias for --store", async () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:web/app.tsx\nDA:10,1\nend_of_record\n");

    expect(
      await main([
        "--suite",
        "frontend",
        "--store-fs",
        storeDir,
        "--artifacts",
        artifactsDir,
        "--sha",
        "deadbeef",
        "--branch",
        "main",
      ]),
    ).toBe(0);

    const stored = readFileSync(join(storeDir, "frontend", "sha", "deadbeef", "lcov.info"), "utf8");
    expect(stored).toContain("SF:web/app.tsx");
  });

  it("round-trips through main() CLI interface", async () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:web/app.tsx\nDA:10,1\nend_of_record\n");

    expect(
      await main([
        "--suite",
        "frontend",
        "--store",
        storeDir,
        "--artifacts",
        artifactsDir,
        "--sha",
        "deadbeef",
        "--branch",
        "main",
      ]),
    ).toBe(0);

    const stored = readFileSync(join(storeDir, "frontend", "sha", "deadbeef", "lcov.info"), "utf8");
    expect(stored).toContain("SF:web/app.tsx");
  });

  it("preserves legacy store-put usage when sha and branch are omitted", async () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:web/app.tsx\nDA:10,1\nend_of_record\n");

    expect(
      await main(["--suite", "frontend", "--store", storeDir, "--artifacts", artifactsDir]),
    ).toBe(0);

    const stored = readFileSync(join(storeDir, "frontend", "lcov.info"), "utf8");
    expect(stored).toContain("SF:web/app.tsx");
  });

  it("accepts branch names with slashes", async () => {
    writeFileSync(join(artifactsDir, "lcov.info"), "SF:web/app.tsx\nDA:10,1\nend_of_record\n");

    expect(
      await main([
        "--suite",
        "frontend",
        "--store",
        storeDir,
        "--artifacts",
        artifactsDir,
        "--sha",
        "deadbeef",
        "--branch",
        "feature/foo",
      ]),
    ).toBe(0);

    const buf = await store.get("frontend", { branch: "feature/foo" });
    expect(buf!.toString()).toContain("SF:web/app.tsx");
  });
});

describe("multi-suite store-put", () => {
  let tmpDir: string;
  let artifactsDir: string;
  let storeDir: string;
  let store: FileSystemSuiteStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "store-put-multi-"));
    artifactsDir = join(tmpDir, "artifacts");
    storeDir = join(tmpDir, "store");
    mkdirSync(artifactsDir, { recursive: true });
    mkdirSync(storeDir);
    store = new FileSystemSuiteStore(storeDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uploads populated subdirs and skips empty ones", async () => {
    const backendDir = join(artifactsDir, "coverage-backend");
    const emptyDir = join(artifactsDir, "coverage-empty");
    mkdirSync(backendDir, { recursive: true });
    mkdirSync(emptyDir, { recursive: true });
    writeFileSync(join(backendDir, "lcov.info"), "SF:backend/a.mts\nDA:1,1\nend_of_record\n");

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      stdoutChunks.push(String(c));
      return true;
    });
    try {
      expect(
        await main([
          "--store",
          storeDir,
          "--artifacts",
          artifactsDir,
          "--sha",
          "abc",
          "--branch",
          "main",
        ]),
      ).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }

    const out = stdoutChunks.join("");
    expect(out).toContain('stored suite "backend"');
    expect(out).toContain('skipping suite "empty"');

    const buf = await store.get("backend", { branch: "main" });
    expect(buf!.toString()).toContain("SF:backend/a.mts");
  });

  it("supports custom --suite-prefix", async () => {
    const webDir = join(artifactsDir, "cov-web");
    mkdirSync(webDir, { recursive: true });
    writeFileSync(join(webDir, "lcov.info"), "SF:web/a.tsx\nDA:1,1\nend_of_record\n");

    expect(
      await main([
        "--store",
        storeDir,
        "--artifacts",
        artifactsDir,
        "--suite-prefix",
        "cov-",
        "--sha",
        "abc",
        "--branch",
        "main",
      ]),
    ).toBe(0);

    const buf = await store.get("web", { branch: "main" });
    expect(buf!.toString()).toContain("SF:web/a.tsx");
  });

  it("skips subdirs that do not match the prefix", async () => {
    const otherDir = join(artifactsDir, "other-backend");
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, "lcov.info"), "SF:backend/a.mts\nDA:1,1\nend_of_record\n");

    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      stdoutChunks.push(String(c));
      return true;
    });
    try {
      expect(
        await main([
          "--store",
          storeDir,
          "--artifacts",
          artifactsDir,
          "--sha",
          "abc",
          "--branch",
          "main",
        ]),
      ).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }

    const out = stdoutChunks.join("");
    expect(out).toContain("nothing to store");
  });

  it("returns 0 when --suite-prefix has no matching subdirs", async () => {
    expect(
      await main([
        "--store",
        storeDir,
        "--artifacts",
        artifactsDir,
        "--sha",
        "abc",
        "--branch",
        "main",
      ]),
    ).toBe(0);
  });

  it("returns 0 and prints 'artifacts directory not found' when artifacts dir does not exist", async () => {
    const nonexistentArtifacts = join(tmpDir, "does-not-exist");
    const stdoutChunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      stdoutChunks.push(String(c));
      return true;
    });
    try {
      expect(
        await main([
          "--store",
          storeDir,
          "--artifacts",
          nonexistentArtifacts,
          "--sha",
          "abc",
          "--branch",
          "main",
        ]),
      ).toBe(0);
      expect(stdoutChunks.join("")).toContain("artifacts directory not found");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("throws when readdirSync fails with a non-ENOENT error (e.g. ENOTDIR)", async () => {
    // Point --artifacts at a file instead of a dir; readdirSync throws ENOTDIR which is re-thrown.
    const notADir = join(tmpDir, "i-am-a-file.txt");
    writeFileSync(notADir, "content");

    await expect(
      main(["--store", storeDir, "--artifacts", notADir, "--sha", "abc", "--branch", "main"]),
    ).rejects.toThrow();
  });
});

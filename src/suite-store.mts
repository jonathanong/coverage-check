import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SuiteMeta } from "./types.mts";

export function assertSafePathComponent(value: string, label: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new Error(`invalid ${label}: ${JSON.stringify(value)}`);
  }
}

export type { SuiteMeta };

export interface SuiteStore {
  /** Returns all suite names currently in the store. */
  list(): Promise<string[]>;
  /**
   * Returns the merged LCOV bytes for a suite, or null if absent.
   * Resolves by sha if opts.sha is set; otherwise follows the branch pointer
   * (opts.branch, defaulting to "main").
   */
  get(suite: string, opts?: { sha?: string; branch?: string }): Promise<Buffer | null>;
  /** Stores the merged LCOV bytes for a suite. sha and branch are required. */
  put(
    suite: string,
    lcov: Buffer,
    meta: SuiteMeta & { sha: string; branch: string },
  ): Promise<void>;
}

/**
 * Filesystem-backed SuiteStore.
 *
 * Layout:
 *   <root>/<suite>/sha/<sha>/lcov.info      — LCOV payload
 *   <root>/<suite>/branch/<branch>/latest.json — { sha, timestamp }
 *
 * Transport is the caller's responsibility (e.g. S3 sync, git orphan branch).
 */
export class FileSystemSuiteStore implements SuiteStore {
  private readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  async list(): Promise<string[]> {
    try {
      return readdirSync(this.root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async get(suite: string, opts?: { sha?: string; branch?: string }): Promise<Buffer | null> {
    assertSafePathComponent(suite, "suite");
    if (opts?.sha !== undefined) assertSafePathComponent(opts.sha, "sha");
    let sha = opts?.sha;
    if (!sha) {
      const branch = opts?.branch ?? "main";
      assertSafePathComponent(branch, "branch");
      const pointerPath = join(this.root, suite, "branch", branch, "latest.json");
      try {
        const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as { sha: string };
        assertSafePathComponent(pointer.sha, "sha");
        sha = pointer.sha;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    }
    const lcovPath = join(this.root, suite, "sha", sha, "lcov.info");
    try {
      return readFileSync(lcovPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async put(
    suite: string,
    lcov: Buffer,
    meta: SuiteMeta & { sha: string; branch: string },
  ): Promise<void> {
    assertSafePathComponent(suite, "suite");
    assertSafePathComponent(meta.sha, "sha");
    assertSafePathComponent(meta.branch, "branch");
    const shaDir = join(this.root, suite, "sha", meta.sha);
    mkdirSync(shaDir, { recursive: true });
    writeFileSync(join(shaDir, "lcov.info"), lcov);

    const branchDir = join(this.root, suite, "branch", meta.branch);
    mkdirSync(branchDir, { recursive: true });
    writeFileSync(
      join(branchDir, "latest.json"),
      JSON.stringify(
        { sha: meta.sha, timestamp: meta.timestamp ?? new Date().toISOString() },
        null,
        2,
      ),
    );
  }
}

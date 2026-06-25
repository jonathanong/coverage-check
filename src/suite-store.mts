import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SuiteMeta } from "./types.mts";

export function assertValidRepo(value: string): void {
  if (value === "") return;
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ||
    value.startsWith("-") ||
    value.includes("/-")
  ) {
    throw new Error(`invalid repo: ${JSON.stringify(value)}`);
  }
}

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

export type SuitePutMeta = { sha: string; branch: string; timestamp?: string };

export function encodeBranchName(branch: string): string {
  if (typeof branch !== "string" || branch.length === 0) {
    throw new Error(`invalid branch: ${JSON.stringify(branch)}`);
  }
  return Buffer.from(branch, "utf8").toString("base64url");
}

export function decodeBranchName(encoded: string): string {
  assertSafePathComponent(encoded, "branch");
  return Buffer.from(encoded, "base64url").toString("utf8");
}

export interface SuiteStore {
  /** Returns all suite names currently in the store. */
  list(): Promise<string[]>;
  /**
   * Returns the merged LCOV bytes for a suite, or null if absent.
   * Resolves by sha if opts.sha is set; otherwise follows the branch pointer
   * (opts.branch, defaulting to "main").
   */
  get(suite: string, opts?: { sha?: string; branch?: string }): Promise<Buffer | null>;
  /** Stores the merged LCOV bytes for a suite. sha and branch enable pointer storage. */
  put(suite: string, lcov: Buffer, meta?: SuitePutMeta): Promise<void>;
}

/**
 * Filesystem-backed SuiteStore.
 *
 * Layout:
 *   <root>/<suite>/sha/<sha>/lcov.info      — LCOV payload
 *   <root>/<suite>/branch/<encoded-branch>/latest.json — { sha, timestamp }
 *
 * Legacy layout is still readable/writable when no sha/branch metadata is given:
 *   <root>/<suite>/lcov.info
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
      const pointerPaths = [
        join(this.root, suite, "branch", encodeBranchName(branch), "latest.json"),
        join(this.root, suite, "branch", branch, "latest.json"),
      ];
      try {
        const pointer = readPointerFile(pointerPaths);
        assertSafePathComponent(pointer.sha, "sha");
        sha = pointer.sha;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return this.getLegacy(suite);
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

  async put(suite: string, lcov: Buffer, meta?: SuitePutMeta): Promise<void> {
    assertSafePathComponent(suite, "suite");
    if (meta === undefined) {
      const suiteDir = join(this.root, suite);
      mkdirSync(suiteDir, { recursive: true });
      writeFileSync(join(suiteDir, "lcov.info"), lcov);
      return;
    }
    const { sha, branch } = meta;
    assertSafePathComponent(sha, "sha");
    const shaDir = join(this.root, suite, "sha", sha);
    mkdirSync(shaDir, { recursive: true });
    writeFileSync(join(shaDir, "lcov.info"), lcov);

    const branchDir = join(this.root, suite, "branch", encodeBranchName(branch));
    mkdirSync(branchDir, { recursive: true });
    const pointerPath = join(branchDir, "latest.json");
    const timestamp = meta.timestamp ?? new Date().toISOString();
    assertValidTimestamp(timestamp);
    if (!this.shouldWritePointer(pointerPath, timestamp)) return;
    writeFileSync(pointerPath, JSON.stringify({ sha, timestamp }, null, 2));
  }

  private getLegacy(suite: string): Buffer | null {
    try {
      return readFileSync(join(this.root, suite, "lcov.info"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  private shouldWritePointer(pointerPath: string, incomingTimestamp: string): boolean {
    try {
      const current = JSON.parse(readFileSync(pointerPath, "utf8")) as { timestamp?: string };
      return !isNewerTimestamp(current.timestamp, incomingTimestamp);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw err;
    }
  }
}

export function isNewerTimestamp(current: string | undefined, incoming: string): boolean {
  assertValidTimestamp(incoming);
  if (!current) return false;
  const currentMs = Date.parse(current);
  const incomingMs = Date.parse(incoming);
  return Number.isFinite(currentMs) && Number.isFinite(incomingMs) && currentMs > incomingMs;
}

export function assertValidTimestamp(timestamp: string): void {
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`invalid timestamp: ${JSON.stringify(timestamp)}`);
  }
}

function readPointerFile(paths: string[]): { sha: string; timestamp?: string } {
  let lastNotFound: NodeJS.ErrnoException | null = null;
  for (const path of paths) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as { sha: string; timestamp?: string };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      lastNotFound = err as NodeJS.ErrnoException;
    }
  }
  throw lastNotFound;
}

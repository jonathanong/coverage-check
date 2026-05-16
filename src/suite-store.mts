import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SuiteMeta } from "./types.mts";

export type { SuiteMeta };

export interface SuiteStore {
  /** Returns all suite names currently in the store. */
  list(): Promise<string[]>;
  /** Returns the merged LCOV bytes for a suite, or null if absent. */
  get(suite: string): Promise<Buffer | null>;
  /** Stores the merged LCOV bytes for a suite, with optional metadata. */
  put(suite: string, lcov: Buffer, meta?: SuiteMeta): Promise<void>;
}

/**
 * Filesystem-backed SuiteStore.
 *
 * Layout:
 *   <root>/<suite>/lcov.info    — merged LCOV text
 *   <root>/<suite>/meta.json   — { sha?, ref?, timestamp }
 *
 * Transport is the caller's responsibility (e.g. git orphan branch, S3 sync,
 * GitHub Actions cache). This class only reads/writes local files.
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

  async get(suite: string): Promise<Buffer | null> {
    const path = join(this.root, suite, "lcov.info");
    try {
      return readFileSync(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async put(suite: string, lcov: Buffer, meta: SuiteMeta = {}): Promise<void> {
    const dir = join(this.root, suite);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lcov.info"), lcov);
    writeFileSync(
      join(dir, "meta.json"),
      JSON.stringify({ ...meta, timestamp: meta.timestamp ?? new Date().toISOString() }, null, 2),
    );
  }
}

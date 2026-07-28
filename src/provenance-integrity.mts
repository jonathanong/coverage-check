import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const SOURCE_HASH_PREFIX = Buffer.concat([
  Buffer.from("coverage-check-source-root"),
  Buffer.from([0]),
  Buffer.from("v1"),
  Buffer.from([0]),
]);

export type NormalizedSources = {
  normalizedLcov: string;
  sources: readonly {
    relativePath: string;
    absolutePath: string;
  }[];
};

export function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function lengthDelimited(hash: ReturnType<typeof createHash>, bytes: Buffer): void {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.byteLength));
  hash.update(length);
  hash.update(bytes);
}

function normalizedSourceBytes(path: string): Buffer {
  const bytes = readFileSync(path);
  return Buffer.from(bytes.filter((byte, index) => byte !== 0x0d || bytes[index + 1] !== 0x0a));
}

export function validateRevision(revision: string): void {
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(`Coverage revision must be a lowercase 40-character SHA: ${revision}`);
  }
}

export function isCoverageRunId(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= 256 && !value.includes("\0")
  );
}

export function validatePathComponent(value: string, label: string): void {
  if (!/^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/.test(value)) {
    throw new Error(`${label} must be a safe path component: ${value}`);
  }
}

export function normalizeSources(root: string, rawLcov: string): NormalizedSources {
  const absoluteRoot = realpathSync(root);
  const sources = new Map<string, string>();
  let sourceLines = 0;
  const normalizedLcov = rawLcov
    .split("\n")
    .map((rawLine) => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith("SF:")) return line;
      sourceLines++;
      const rawPath = line.slice(3);
      const foreignWindowsAbsolutePath = sep !== "\\" && /^[A-Za-z]:[\\/]/.test(rawPath);
      if (rawPath.length === 0 || rawPath.includes("\0") || foreignWindowsAbsolutePath) {
        throw new Error("LCOV source path must be non-empty and contain no NUL bytes");
      }
      const unresolvedCandidate = isAbsolute(rawPath)
        ? resolve(rawPath)
        : resolve(absoluteRoot, rawPath);
      let stat;
      try {
        stat = lstatSync(unresolvedCandidate);
      } catch {
        throw new Error(`LCOV source is not a regular file: ${rawPath}`);
      }
      if (stat.isSymbolicLink()) throw new Error(`LCOV source must not be a symlink: ${rawPath}`);
      if (!stat.isFile()) throw new Error(`LCOV source is not a regular file: ${rawPath}`);
      const candidate = realpathSync(unresolvedCandidate);
      const relativePath = relative(absoluteRoot, candidate).split(sep).join("/");
      if (
        relativePath.length === 0 ||
        relativePath === ".." ||
        relativePath.startsWith("../") ||
        isAbsolute(relativePath)
      ) {
        throw new Error(`LCOV source escapes repository root: ${rawPath}`);
      }
      sources.set(relativePath, candidate);
      return `SF:${relativePath}`;
    })
    .join("\n");

  if (sourceLines === 0 || sources.size === 0) {
    throw new Error("LCOV must contain at least one valid source");
  }

  return {
    normalizedLcov,
    sources: [...sources.entries()]
      .toSorted(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
      .map(([relativePath, absolutePath]) => ({ relativePath, absolutePath })),
  };
}

export function sourceRootDigest(sources: NormalizedSources["sources"]): string {
  const hash = createHash("sha256").update(SOURCE_HASH_PREFIX);
  for (const source of sources) {
    lengthDelimited(hash, Buffer.from(source.relativePath));
    lengthDelimited(hash, normalizedSourceBytes(source.absolutePath));
  }
  return hash.digest("hex");
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => Buffer.from(left).compare(Buffer.from(right)))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

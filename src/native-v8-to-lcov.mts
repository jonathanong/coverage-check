import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { minimatch } from "minimatch";
import MCR from "monocart-coverage-reports";
import { assertNativeV8Inputs } from "./native-v8-input.mts";

export type NativeV8ToLcovOptions = {
  v8Dir: string;
  sourceRoot: string;
  include: string[];
  exclude?: string[];
  output: string;
};

export type NativeV8ToLcovResult = {
  files: number;
  sourceHashes: Record<string, string>;
};

function sourcePath(url: string, root: string): string | null {
  if (!url.startsWith("file://")) return null;
  let file: string;
  try {
    file = fileURLToPath(url);
  } catch {
    return null;
  }
  const path = relative(root, file).split(sep).join("/");
  if (path === "" || path === ".." || path.startsWith("../") || isAbsolute(path)) return null;
  return path;
}

function assertPhysicalSource(url: string, root: string): string {
  const file = fileURLToPath(url);
  const physical = realpathSync(file);
  const path = relative(root, physical);
  if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`V8 source resolves outside source root: ${url}`);
  }
  return readFileSync(physical, "utf8");
}

function preservesOffsets(source: string, stripped: string): boolean {
  if (source.length !== stripped.length) return false;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n" || source[i] === "\r") {
      if (source[i] !== stripped[i]) return false;
    } else if (stripped[i] === "\n" || stripped[i] === "\r") {
      return false;
    }
  }
  return true;
}

function assertStrictlyParsable(source: string, path: string): void {
  try {
    // Match Monocart's strict Acorn pass. Its loose-parser fallback can emit
    // plausible LCOV for syntax that it could not actually understand.
    parse(source, {
      ecmaVersion: "latest",
      allowReturnOutsideFunction: true,
      allowImportExportEverywhere: true,
      allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true,
      allowHashBang: true,
    });
  } catch (error) {
    throw new Error(`cannot strictly parse executed source ${path}`, { cause: error });
  }
}

/** Convert executed Node V8 coverage to LCOV without adding empty-file counters. */
export async function convertNativeV8ToLcov(
  options: NativeV8ToLcovOptions,
): Promise<NativeV8ToLcovResult> {
  const root = resolve(options.sourceRoot);
  const physicalRoot = realpathSync(root);
  const v8Dir = resolve(options.v8Dir);
  const output = resolve(options.output);
  if (options.include.length === 0 || options.include.some((pattern) => pattern.length === 0)) {
    throw new Error("at least one non-empty include pattern is required");
  }
  assertNativeV8Inputs(v8Dir);
  const stripTypeScriptTypes = (await import("node:module")).stripTypeScriptTypes;
  if (typeof stripTypeScriptTypes !== "function") {
    throw new Error("native TypeScript coverage requires Node with stripTypeScriptTypes support");
  }

  const included = (path: string): boolean =>
    options.include.some((pattern) => minimatch(path, pattern, { dot: true })) &&
    !(options.exclude ?? []).some((pattern) => minimatch(path, pattern, { dot: true }));
  const sourceHashes = new Map<string, string>();
  mkdirSync(dirname(output), { recursive: true });
  const temporary = mkdtempSync(join(dirname(output), ".coverage-check-native-v8-"));
  try {
    await new MCR.CoverageReport({
      dataDir: v8Dir,
      outputDir: temporary,
      baseDir: root,
      reports: ["lcovonly"],
      logging: "error",
      clean: true,
      entryFilter: (entry) => {
        const path = sourcePath(entry.url, root);
        if (path === null || !included(path)) return false;
        assertPhysicalSource(entry.url, physicalRoot);
        return true;
      },
      onEntry: (entry) => {
        const path = sourcePath(entry.url, root);
        if (path === null || !included(path)) throw new Error(`unexpected V8 source: ${entry.url}`);
        if (typeof entry.source !== "string") throw new Error(`missing V8 source: ${path}`);
        if (entry.source !== assertPhysicalSource(entry.url, physicalRoot)) {
          throw new Error(`V8 source differs from the checkout: ${path}`);
        }
        const hash = createHash("sha256").update(entry.source).digest("hex");
        const previous = sourceHashes.get(path);
        if (previous !== undefined && previous !== hash) {
          throw new Error(`conflicting V8 source text for ${path}`);
        }
        sourceHashes.set(path, hash);
        if (/\.(?:ts|mts|cts)$/.test(path)) {
          if (entry.sourceMap !== undefined && entry.sourceMap !== null) {
            throw new Error(`raw TypeScript source map is unsupported for ${path}`);
          }
          const stripped = stripTypeScriptTypes(entry.source, { mode: "strip" });
          if (!preservesOffsets(entry.source, stripped)) {
            throw new Error(`TypeScript stripping changed source offsets for ${path}`);
          }
          entry.source = stripped;
        }
        assertStrictlyParsable(entry.source, path);
      },
    }).generate();

    if (sourceHashes.size === 0) throw new Error("native V8 coverage produced no included sources");
    const report = resolve(temporary, "lcov.info");
    if (!existsSync(report)) throw new Error("Monocart did not produce LCOV");
    const lcov = readFileSync(report, "utf8");
    const files = [...lcov.matchAll(/^SF:(.+)$/gm)].map((match) => match[1]!);
    if (files.length === 0) throw new Error("native V8 coverage produced no included sources");
    const fileSet = new Set(files);
    if (fileSet.size !== files.length) throw new Error("Monocart emitted duplicate LCOV sources");
    for (const file of files) {
      if (!included(file) || !sourceHashes.has(file)) {
        throw new Error(`LCOV source is outside the requested source scope: ${file}`);
      }
    }
    if (
      files.length !== sourceHashes.size ||
      [...sourceHashes.keys()].some((file) => !fileSet.has(file))
    ) {
      throw new Error("Monocart omitted one or more included V8 sources");
    }
    const staged = resolve(temporary, "published.lcov.info");
    // The report is complete and validated before replacing the requested output.
    renameSync(report, staged);
    renameSync(staged, output);
    return { files: files.length, sourceHashes: Object.fromEntries([...sourceHashes].sort()) };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "acorn";
import { convert } from "ast-v8-to-istanbul";
import coverage from "istanbul-lib-coverage";
import libReport from "istanbul-lib-report";
import reports from "istanbul-reports";
import { minimatch } from "minimatch";
import {
  assertNativeV8Inputs,
  assertPreservedOffsets,
  requireTypeStripper,
} from "./native-v8-input.mts";

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

function sourcePath(url: string, roots: string[]): string | null {
  if (!url.startsWith("file://")) return null;
  for (const root of roots) {
    const path = relative(root, fileURLToPath(url)).split(sep).join("/");
    if (path !== "" && path !== ".." && !path.startsWith("../") && !isAbsolute(path)) {
      return path;
    }
  }
  return null;
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

function parseExecutedSource(source: string, path: string): ReturnType<typeof parse> {
  try {
    return parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      locations: true,
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
  const lexicalRoot = resolve(options.sourceRoot);
  const root = realpathSync(lexicalRoot);
  const v8Dir = resolve(options.v8Dir);
  const output = resolve(options.output);
  if (options.include.length === 0 || options.include.some((pattern) => pattern.length === 0)) {
    throw new Error("at least one non-empty include pattern is required");
  }
  assertNativeV8Inputs(v8Dir);
  const stripTypeScriptTypes = requireTypeStripper(
    (await import("node:module")).stripTypeScriptTypes,
  );

  const included = (path: string): boolean =>
    options.include.some((pattern) => minimatch(path, pattern, { dot: true })) &&
    !(options.exclude ?? []).some((pattern) => minimatch(path, pattern, { dot: true }));
  const sourceHashes = new Map<string, string>();
  const coverageMap = coverage.createCoverageMap({});
  mkdirSync(dirname(output), { recursive: true });
  const temporary = mkdtempSync(join(dirname(output), ".coverage-check-native-v8-"));
  try {
    for (const name of readdirSync(v8Dir).filter((file) => /^coverage-.*\.json$/.test(file))) {
      const raw = JSON.parse(readFileSync(join(v8Dir, name), "utf8")) as {
        result: Array<{
          url: string;
          functions: Array<{
            functionName: string;
            isBlockCoverage: boolean;
            ranges: Array<{ startOffset: number; endOffset: number; count: number }>;
          }>;
        }>;
      };
      for (const entry of raw.result) {
        const path = sourcePath(entry.url, [root, lexicalRoot]);
        if (path === null || !included(path)) continue;
        const source = assertPhysicalSource(entry.url, root);
        const hash = createHash("sha256").update(source).digest("hex");
        const previous = sourceHashes.get(path);
        if (previous !== undefined && previous !== hash) {
          throw new Error(`V8 source changed between captures: ${path}`);
        }
        sourceHashes.set(path, hash);
        let code = source;
        if (/\.(?:ts|mts|cts)$/.test(path)) {
          code = stripTypeScriptTypes(source, { mode: "strip" });
          assertPreservedOffsets(source, code, path);
        }
        const ast = parseExecutedSource(code, path);
        coverageMap.merge(
          await convert({
            ast,
            code,
            coverage: { ...entry, url: pathToFileURL(resolve(root, path)).href },
          }),
        );
      }
    }

    if (sourceHashes.size === 0) throw new Error("native V8 coverage produced no included sources");
    reports
      .create("lcovonly", { projectRoot: root })
      .execute(libReport.createContext({ dir: temporary, coverageMap }));
    const report = resolve(temporary, "lcov.info");
    if (!existsSync(report)) throw new Error("Istanbul did not produce LCOV");
    const lcov = readFileSync(report, "utf8");
    const files = [...lcov.matchAll(/^SF:(.+)$/gm)].map((match) => match[1]!);
    if (files.length === 0) throw new Error("native V8 coverage produced no included sources");
    const fileSet = new Set(files);
    if (fileSet.size !== files.length) throw new Error("Istanbul emitted duplicate LCOV sources");
    for (const file of files) {
      if (!included(file) || !sourceHashes.has(file)) {
        throw new Error(`LCOV source is outside the requested source scope: ${file}`);
      }
    }
    if (
      files.length !== sourceHashes.size ||
      [...sourceHashes.keys()].some((file) => !fileSet.has(file))
    ) {
      throw new Error("Istanbul omitted one or more included V8 sources");
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

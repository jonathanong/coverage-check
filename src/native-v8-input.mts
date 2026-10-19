import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function validFunction(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  if (!("functionName" in value) || typeof value.functionName !== "string") return false;
  if (!("isBlockCoverage" in value) || typeof value.isBlockCoverage !== "boolean") return false;
  if (!("ranges" in value) || !Array.isArray(value.ranges) || value.ranges.length === 0) {
    return false;
  }
  return value.ranges.every(
    (range) =>
      typeof range === "object" &&
      range !== null &&
      "startOffset" in range &&
      Number.isSafeInteger(range.startOffset) &&
      range.startOffset >= 0 &&
      "endOffset" in range &&
      Number.isSafeInteger(range.endOffset) &&
      range.endOffset >= range.startOffset &&
      "count" in range &&
      Number.isSafeInteger(range.count) &&
      range.count >= 0,
  );
}

/** Reject malformed raw coverage before converting any executed source. */
export function assertNativeV8Inputs(dir: string): void {
  let coverageFiles = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const value: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
    if (/^coverage-.*\.json$/.test(name)) {
      coverageFiles++;
      if (
        typeof value !== "object" ||
        value === null ||
        !("result" in value) ||
        !Array.isArray(value.result) ||
        value.result.length === 0 ||
        "source-map-cache" in value ||
        !value.result.every(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            "url" in entry &&
            typeof entry.url === "string" &&
            "functions" in entry &&
            Array.isArray(entry.functions) &&
            entry.functions.length > 0 &&
            entry.functions.every(validFunction),
        )
      ) {
        throw new Error(`invalid Node V8 coverage file: ${name}`);
      }
      for (const entry of value.result) {
        if (!entry.url.startsWith("file:")) continue;
        try {
          fileURLToPath(entry.url);
        } catch {
          throw new Error(`invalid file URL in Node V8 coverage file: ${name}`);
        }
      }
    } else {
      throw new Error(`unexpected JSON in Node V8 coverage directory: ${name}`);
    }
  }
  if (coverageFiles === 0) throw new Error(`no Node V8 coverage files found under ${dir}`);
}

export function requireTypeStripper(
  value: unknown,
): (source: string, options: { mode: "strip" }) => string {
  if (typeof value !== "function") {
    throw new Error("native TypeScript coverage requires Node with stripTypeScriptTypes support");
  }
  return value as (source: string, options: { mode: "strip" }) => string;
}

export function assertPreservedOffsets(source: string, stripped: string, path: string): void {
  if (source.length !== stripped.length) {
    throw new Error(`TypeScript stripping changed source offsets for ${path}`);
  }
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n" || source[i] === "\r") {
      if (source[i] !== stripped[i]) {
        throw new Error(`TypeScript stripping changed source offsets for ${path}`);
      }
    } else if (stripped[i] === "\n" || stripped[i] === "\r") {
      throw new Error(`TypeScript stripping changed source offsets for ${path}`);
    }
  }
}

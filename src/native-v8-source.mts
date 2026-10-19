import { readFileSync, realpathSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { compileFunction } from "node:vm";
import { parse } from "acorn";

type SourceType = "module" | "commonjs";

function packageSourceType(file: string): SourceType | undefined {
  let directory = dirname(file);
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        type?: unknown;
      } | null;
      return manifest?.type === "module" || manifest?.type === "commonjs"
        ? manifest.type
        : undefined;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function sourceType(source: string, file: string): SourceType {
  const extension = extname(file);
  if (extension === ".mjs" || extension === ".mts") return "module";
  if (extension === ".cjs" || extension === ".cts") return "commonjs";
  const declared = packageSourceType(file);
  if (declared !== undefined) return declared;
  try {
    // Match Node's CommonJS-first syntax detection without evaluating the source.
    compileFunction(source.replace(/^#![^\r\n]*/, ""), [
      "exports",
      "require",
      "module",
      "__filename",
      "__dirname",
    ]);
    return "commonjs";
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return "module";
  }
}

export function parseExecutedSource(source: string, file: string): ReturnType<typeof parse> {
  try {
    return parse(source, {
      ecmaVersion: "latest",
      sourceType: sourceType(source, realpathSync(file)),
      locations: true,
      allowHashBang: true,
    });
  } catch (error) {
    throw new Error(`cannot strictly parse executed source ${file}`, { cause: error });
  }
}

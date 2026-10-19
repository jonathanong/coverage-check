import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseLcovFull } from "./lcov-records.mts";
import { parseExecutedSource } from "./native-v8-source.mts";
import { convertNativeV8ToLcov } from "./native-v8-to-lcov.mts";

const directories: string[] = [];
afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(extension: string, type?: string, parentType?: string) {
  const root = mkdtempSync(join(tmpdir(), "coverage-check-native-grammar-"));
  directories.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ type: parentType }));
  const directory = join(root, "nested");
  mkdirSync(directory);
  writeFileSync(join(directory, "package.json"), JSON.stringify({ type }));
  return { root, file: join(directory, `fixture.${extension}`) };
}

async function capture(extension: string, source: string, type?: string, parentType?: string) {
  const { root, file } = fixture(extension, type, parentType);
  writeFileSync(file, source);
  const raw = join(root, "raw");
  mkdirSync(raw);
  execFileSync(process.execPath, [file], {
    env: { ...process.env, NODE_V8_COVERAGE: raw, NODE_DISABLE_COMPILE_CACHE: "1" },
    stdio: "pipe",
  });
  const output = join(root, "lcov.info");
  await convertNativeV8ToLcov({
    v8Dir: raw,
    sourceRoot: root,
    include: [`nested/fixture.${extension}`],
    output,
  });
  return parseLcovFull(readFileSync(output, "utf8")).get(`nested/fixture.${extension}`)!;
}

const commonjs = `with ({ value: 3 }) {
  if (value !== 3) throw new Error('unexpected')
}
function unused() {
  return 9
}
void new.target
return
`;

const typedCommonjs = `const value: number = 3
if (value !== 3) throw new Error('unexpected')
;
function unused() {
  return 9
}
void module
module.exports = value
`;

function commonjsSource(extension: string): string {
  return extension === "ts" || extension === "cts" ? typedCommonjs : commonjs;
}

const moduleSource = `export const value = await Promise.resolve(3)
if (value !== 3) throw new Error('unexpected')
function unused() {
  return 9
}
`;

describe("native source module grammar", () => {
  it.each(["cjs", "cts"])(
    "converts %s with CommonJS wrapper syntax despite a module package",
    async (extension) => {
      const file = await capture(extension, commonjsSource(extension), "module");
      expect(file.lines.get(2)).toBeGreaterThan(0);
      expect(file.lines.get(5)).toBe(0);
      expect(file.lines.get(8)).toBeGreaterThan(0);
    },
  );

  it.each(["js", "ts"])("honors an explicit commonjs package for %s", async (extension) => {
    const file = await capture(extension, commonjsSource(extension), "commonjs", "module");
    expect(file.lines.get(5)).toBe(0);
    expect(file.lines.get(8)).toBeGreaterThan(0);
  });

  it.each(["js", "ts"])(
    "stops at a typeless nearest package and detects sloppy %s as CommonJS",
    async (extension) => {
      const file = await capture(extension, commonjsSource(extension), undefined, "module");
      expect(file.lines.get(5)).toBe(0);
      expect(file.lines.get(8)).toBeGreaterThan(0);
    },
  );

  it("detects typeless hashbang JavaScript as sloppy CommonJS", async () => {
    const file = await capture("js", "#!/usr/bin/env node\n" + commonjs);
    expect(file.lines.get(3)).toBeGreaterThan(0);
    expect(file.lines.get(6)).toBe(0);
    expect(file.lines.get(9)).toBeGreaterThan(0);
  });

  it.each(["mjs", "mts"])(
    "converts %s as a module despite a commonjs package",
    async (extension) => {
      const file = await capture(extension, moduleSource, "commonjs");
      expect(file.lines.get(1)).toBeGreaterThan(0);
      expect(file.lines.get(4)).toBe(0);
    },
  );

  it.each(["js", "ts"])("honors an explicit module package for %s", async (extension) => {
    const file = await capture(extension, moduleSource, "module", "commonjs");
    expect(file.lines.get(1)).toBeGreaterThan(0);
    expect(file.lines.get(4)).toBe(0);
  });

  it.each(["js", "ts"])("detects module syntax in typeless %s", async (extension) => {
    const file = await capture(extension, moduleSource);
    expect(file.lines.get(1)).toBeGreaterThan(0);
    expect(file.lines.get(4)).toBe(0);
  });

  it.each(["js", "ts"])(
    "detects a CommonJS wrapper lexical collision in typeless %s",
    async (extension) => {
      const file = await capture(
        extension,
        "const module = 3\nif (module !== 3) throw new Error('unexpected')\n",
      );
      expect(file.lines.get(1)).toBeGreaterThan(0);
    },
  );

  it.each([
    ["mjs", undefined, "with ({}) {}"],
    ["mts", undefined, "return 1"],
    ["js", "module", "with ({}) {}"],
    ["ts", "module", "return 1"],
    ["cjs", undefined, "await 1"],
    ["cts", undefined, "import 'node:fs'"],
    ["js", "commonjs", "await 1"],
    ["ts", "commonjs", "import 'node:fs'"],
  ])("rejects incompatible %s grammar with package type %s", (extension, type, source) => {
    const { file } = fixture(extension!, type);
    writeFileSync(file, source!);
    expect(() => parseExecutedSource(source!, file)).toThrow("cannot strictly parse");
  });

  it("uses the ancestor package when the source directory has no manifest", () => {
    const { root, file } = fixture("js", undefined, "commonjs");
    rmSync(join(root, "nested", "package.json"));
    writeFileSync(file, commonjs);
    expect(() => parseExecutedSource(commonjs, file)).not.toThrow();
  });

  it("rejects an unreadable package contract rather than guessing its grammar", () => {
    const { root, file } = fixture("js");
    writeFileSync(file, "const value = 1");
    writeFileSync(join(root, "nested", "package.json"), "{");
    expect(() => parseExecutedSource("const value = 1", file)).toThrow("cannot strictly parse");
  });

  it("compiles syntax detection without evaluating user source", () => {
    const { file } = fixture("js");
    const source = "throw new Error('syntax detection must not execute')";
    writeFileSync(file, source);
    expect(() => parseExecutedSource(source, file)).not.toThrow();
  });
});

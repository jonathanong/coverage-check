import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseLcovFull } from "./lcov-records.mts";
import { convertNativeV8ToLcov } from "./native-v8-to-lcov.mts";
import { main, parseNativeV8ToLcovArgs } from "./commands/native-v8-to-lcov.mts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function captureFixture(
  sourceOverride?: string,
  extension = "mts",
): { root: string; v8Dir: string; source: string; fileName: string } {
  const root = mkdtempSync(join(tmpdir(), "coverage-check-native-v8-test-"));
  directories.push(root);
  const v8Dir = join(root, "raw-v8");
  mkdirSync(v8Dir);
  const source =
    sourceOverride ??
    `type Request = {
  value: number
  enabled: boolean
}

function called(
  request: Request,
  multiplier: number,
): number {
  return request.value * multiplier
}

function uncalled(
  request: Request,
  multiplier: number,
): number {
  const neverExecuted = request.value + multiplier
  return neverExecuted
}

function branch(flag: boolean): number {
  if (flag) return 1
  return 2
}

const answer = called({
  value: 3,
  enabled: true,
}, 2)
if (answer !== 6 || branch(true) !== 1) throw new Error('unexpected result')
`;
  const fileName = `fixture.${extension}`;
  writeFileSync(join(root, fileName), source);
  execFileSync(process.execPath, [join(root, fileName)], {
    cwd: root,
    env: { ...process.env, NODE_V8_COVERAGE: v8Dir, NODE_DISABLE_COMPILE_CACHE: "1" },
    stdio: "pipe",
  });
  return { root, v8Dir, source, fileName };
}

describe("native V8 to LCOV", () => {
  it.each(["physical", "lexical"])(
    "resolves a symlinked source root with %s raw URLs",
    async (spelling) => {
      const { root, v8Dir } = captureFixture();
      const alias = `${root}-alias`;
      directories.push(alias);
      symlinkSync(root, alias, "dir");
      if (spelling === "lexical") {
        for (const name of readdirSync(v8Dir)) {
          const capture = join(v8Dir, name);
          const raw = JSON.parse(readFileSync(capture, "utf8"));
          const entry = raw.result.find((item: { url: string }) =>
            item.url.endsWith("fixture.mts"),
          );
          entry.url = pathToFileURL(join(alias, "fixture.mts")).href;
          writeFileSync(capture, JSON.stringify(raw));
        }
      }
      const output = join(root, "alias.lcov.info");
      const result = await convertNativeV8ToLcov({
        v8Dir,
        sourceRoot: alias,
        include: ["fixture.mts"],
        output,
      });
      expect(result.files).toBe(1);
      expect(readFileSync(output, "utf8")).toContain("SF:fixture.mts");
    },
  );

  it("merges counts from two executed captures of the same source", async () => {
    const { root, v8Dir, source } = captureFixture();
    const capture = join(
      v8Dir,
      readdirSync(v8Dir).find((name) => name.startsWith("coverage-"))!,
    );
    const args = { v8Dir, sourceRoot: root, include: ["fixture.mts"] };
    const once = join(root, "once.lcov.info");
    await convertNativeV8ToLcov({ ...args, output: once });
    writeFileSync(join(v8Dir, "coverage-second.json"), readFileSync(capture));
    const twice = join(root, "twice.lcov.info");
    await convertNativeV8ToLcov({ ...args, output: twice });
    const line = source
      .slice(0, source.indexOf("return request.value * multiplier"))
      .split("\n").length;
    const hits = (file: string) =>
      Number(readFileSync(file, "utf8").match(new RegExp(`^DA:${line},(\\d+)$`, "m"))?.[1]);
    expect(hits(once)).toBeGreaterThan(0);
    expect(hits(twice)).toBe(hits(once) * 2);
  });

  it.each(["root", "parent", "sibling"] as const)(
    "does not turn a %s URL into an included source file",
    async (location) => {
      const { root, v8Dir } = captureFixture();
      const capture = join(
        v8Dir,
        readdirSync(v8Dir).find((name) => name.startsWith("coverage-"))!,
      );
      const raw = JSON.parse(readFileSync(capture, "utf8"));
      const outside =
        location === "root"
          ? root
          : location === "parent"
            ? dirname(root)
            : join(dirname(root), "other.mts");
      raw.result.find((entry: { url: string }) => entry.url.endsWith("fixture.mts")).url =
        pathToFileURL(outside).href;
      writeFileSync(capture, JSON.stringify(raw));
      await expect(
        convertNativeV8ToLcov({
          v8Dir,
          sourceRoot: root,
          include: ["*.mts"],
          output: join(root, "filtered.lcov.info"),
        }),
      ).rejects.toThrow("no included sources");
    },
  );

  it("omits type-only and call-continuation counters while retaining real uncovered code", async () => {
    const { root, v8Dir, source } = captureFixture();
    const output = join(root, "report", "lcov.info");
    const result = await convertNativeV8ToLcov({
      v8Dir,
      sourceRoot: root,
      include: ["fixture.mts"],
      output,
    });
    expect(result.files).toBe(1);
    expect(result.sourceHashes["fixture.mts"]).toBe(
      createHash("sha256").update(source).digest("hex"),
    );
    const file = parseLcovFull(readFileSync(output, "utf8")).get("fixture.mts");
    expect(file).toBeDefined();
    expect(file?.lines.get(10)).toBeGreaterThan(0);
    expect(file?.lines.has(7)).toBe(false);
    expect(file?.lines.has(8)).toBe(false);
    expect(file?.lines.has(14)).toBe(false);
    expect(file?.lines.has(29)).toBe(false);
    expect(file?.lines.get(17)).toBe(0);
    expect(file?.lines.get(18)).toBe(0);
    expect([...file!.branches.values()]).toContain(0);
  });

  it("rejects unsupported TypeScript rather than publishing an incomplete report", async () => {
    const { root, v8Dir } = captureFixture();
    writeFileSync(join(root, "fixture.mts"), "enum Choice { First }\n");
    const output = join(root, "invalid.lcov.info");
    writeFileSync(output, "existing report\n");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["fixture.mts"], output }),
    ).rejects.toThrow();
    expect(readFileSync(output, "utf8")).toBe("existing report\n");
  });

  it("rejects JavaScript that would reach the reporter's loose-parser fallback", async () => {
    const { root, v8Dir, fileName } = captureFixture("const ok = 1\n", "mjs");
    writeFileSync(join(root, fileName), "const broken = ;\n");
    const output = join(root, "invalid-js.lcov.info");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: [fileName], output }),
    ).rejects.toThrow("cannot strictly parse");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects a malformed capture beside a valid one before replacing output", async () => {
    const { root, v8Dir } = captureFixture();
    writeFileSync(join(v8Dir, "coverage-empty.json"), JSON.stringify({ result: [] }));
    const output = join(root, "report.lcov.info");
    writeFileSync(output, "old report\n");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["fixture.mts"], output }),
    ).rejects.toThrow("invalid Node V8 coverage file");
    expect(readFileSync(output, "utf8")).toBe("old report\n");
  });

  it("rejects empty V8 function and range payloads beside a valid capture", async () => {
    const { root, v8Dir } = captureFixture();
    const valid = join(
      v8Dir,
      readdirSync(v8Dir).find((name) => name.startsWith("coverage-"))!,
    );
    const raw = JSON.parse(readFileSync(valid, "utf8"));
    const included = raw.result.find((entry: { url: string }) => entry.url.endsWith("fixture.mts"));
    const output = join(root, "report.lcov.info");
    writeFileSync(output, "old report\n");
    for (const functions of [[], [{ functionName: "", ranges: [], isBlockCoverage: true }]]) {
      writeFileSync(
        join(v8Dir, "coverage-malformed.json"),
        JSON.stringify({ result: [{ ...included, functions }] }),
      );
      await expect(
        convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["fixture.mts"], output }),
      ).rejects.toThrow("invalid Node V8 coverage file");
      expect(readFileSync(output, "utf8")).toBe("old report\n");
    }
  });

  it("rejects source caches and source maps in the raw capture directory", async () => {
    const { root, v8Dir } = captureFixture();
    const output = join(root, "report.lcov.info");
    writeFileSync(
      join(v8Dir, "source-untrusted.json"),
      JSON.stringify({ url: "file:///x", source: "" }),
    );
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["fixture.mts"], output }),
    ).rejects.toThrow("unexpected JSON");
    rmSync(join(v8Dir, "source-untrusted.json"));
    const capture = join(
      v8Dir,
      readdirSync(v8Dir).find((name) => name.startsWith("coverage-"))!,
    );
    const raw = JSON.parse(readFileSync(capture, "utf8"));
    raw["source-map-cache"] = {};
    writeFileSync(capture, JSON.stringify(raw));
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["fixture.mts"], output }),
    ).rejects.toThrow("invalid Node V8 coverage file");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects a lexical source path whose symlink resolves outside the root", async () => {
    const { root, v8Dir, source } = captureFixture();
    const outside = mkdtempSync(join(tmpdir(), "coverage-check-native-outside-"));
    directories.push(outside);
    writeFileSync(join(outside, "outside.mts"), source);
    symlinkSync(join(outside, "outside.mts"), join(root, "linked.mts"));
    const capture = join(
      v8Dir,
      readdirSync(v8Dir).find((name) => name.startsWith("coverage-"))!,
    );
    const raw = JSON.parse(readFileSync(capture, "utf8"));
    const fixture = raw.result.find((entry: { url: string }) => entry.url.endsWith("fixture.mts"));
    fixture.url = pathToFileURL(join(root, "linked.mts")).href;
    writeFileSync(capture, JSON.stringify(raw));
    const output = join(root, "report.lcov.info");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["linked.mts"], output }),
    ).rejects.toThrow("outside source root");
    expect(existsSync(output)).toBe(false);
  });

  it("rejects malformed file URLs rather than silently dropping an executed entry", async () => {
    const { root, v8Dir } = captureFixture();
    const capture = join(
      v8Dir,
      readdirSync(v8Dir).find((name) => name.startsWith("coverage-"))!,
    );
    const raw = JSON.parse(readFileSync(capture, "utf8"));
    raw.result.find((entry: { url: string }) => entry.url.endsWith("fixture.mts")).url = "file://%";
    writeFileSync(capture, JSON.stringify(raw));
    const output = join(root, "report.lcov.info");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["fixture.mts"], output }),
    ).rejects.toThrow("invalid file URL");
    expect(existsSync(output)).toBe(false);
  });

  it("preserves UTF-16 offsets and CRLF line boundaries", async () => {
    const source = [
      "type Payload = { value: number }",
      "const emoji = '🌕'",
      "function used(input: Payload): number {",
      "  return input.value + emoji.length",
      "}",
      "function unused(input: Payload): number {",
      "  return input.value",
      "}",
      "if (used({ value: 2 }) !== 4) throw new Error('unexpected')",
      "",
    ].join("\r\n");
    const { root, v8Dir } = captureFixture(source);
    const output = join(root, "crlf.lcov.info");
    await convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["fixture.mts"], output });
    const file = parseLcovFull(readFileSync(output, "utf8")).get("fixture.mts");
    expect(file?.lines.has(1)).toBe(false);
    expect(file?.lines.get(4)).toBeGreaterThan(0);
    expect(file?.lines.get(7)).toBe(0);
  });

  it("fails closed when no executed source matches the requested scope", async () => {
    const { root, v8Dir } = captureFixture();
    const output = join(root, "missing.lcov.info");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["other/**"], output }),
    ).rejects.toThrow("no included sources");
    expect(existsSync(output)).toBe(false);
  });

  it("requires a nonempty direct API scope and honors exclusions", async () => {
    const { root, v8Dir } = captureFixture();
    const output = join(root, "report.lcov.info");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: [], output }),
    ).rejects.toThrow("include pattern");
    await expect(
      convertNativeV8ToLcov({
        v8Dir,
        sourceRoot: root,
        include: ["fixture.mts"],
        exclude: ["fixture.mts"],
        output,
      }),
    ).rejects.toThrow("no included sources");
    expect(existsSync(output)).toBe(false);
  });

  it("requires an explicit source scope and output in the CLI", () => {
    expect(() => parseNativeV8ToLcovArgs(["--v8-dir"])).toThrow("requires a value");
    expect(() => parseNativeV8ToLcovArgs(["--v8-dir", "raw"])).toThrow("required");
    expect(() => parseNativeV8ToLcovArgs(["--unknown", "value"])).toThrow("unknown flag");
    expect(
      parseNativeV8ToLcovArgs([
        "--v8-dir",
        "raw",
        "--source-root",
        "root",
        "--include",
        "src/**",
        "--exclude",
        "**/*.test.mts",
        "--output",
        "report.lcov",
      ]),
    ).toEqual({
      v8Dir: "raw",
      sourceRoot: "root",
      include: ["src/**"],
      exclude: ["**/*.test.mts"],
      output: "report.lcov",
    });
  });

  it("runs the CLI on an owned capture and returns an error for invalid input", async () => {
    const { root, v8Dir } = captureFixture();
    const output = join(root, "cli.lcov.info");
    expect(
      await main([
        "--v8-dir",
        v8Dir,
        "--source-root",
        root,
        "--include",
        "fixture.mts",
        "--output",
        output,
      ]),
    ).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("SF:fixture.mts");
    expect(await main(["--unknown", "value"])).toBe(2);
  });
});

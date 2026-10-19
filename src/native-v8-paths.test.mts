import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseLcovFull } from "./lcov-records.mts";
import { convertNativeV8ToLcov } from "./native-v8-to-lcov.mts";

const directories: string[] = [];
afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "coverage-check-native-paths-"));
  directories.push(root);
  const raw = join(root, "raw");
  mkdirSync(raw);
  const source = `const value: number = 3
function unused() {
  return 9
}
module.exports = value
`;
  const file = join(root, "fixture.cts");
  writeFileSync(file, source);
  execFileSync(process.execPath, [file], {
    env: { ...process.env, NODE_V8_COVERAGE: raw, NODE_DISABLE_COMPILE_CACHE: "1" },
    stdio: "pipe",
  });
  const capture = join(
    raw,
    readdirSync(raw).find((name) => name.startsWith("coverage-"))!,
  );
  const data = JSON.parse(readFileSync(capture, "utf8")) as {
    result: { url: string; functions: unknown[] }[];
  };
  const entry = data.result.find((item) => item.url.endsWith("fixture.cts"))!;
  // Node 22 emits this exact absolute-path spelling for native TypeScript CommonJS.
  entry.url = entry.url.startsWith("file:") ? fileURLToPath(entry.url) : entry.url;
  const output = join(root, "lcov.info");
  const save = () => writeFileSync(capture, JSON.stringify(data));
  const convert = (exclude: string[] = []) => {
    save();
    return convertNativeV8ToLcov({
      v8Dir: raw,
      sourceRoot: root,
      include: ["*.cts"],
      exclude,
      output,
    });
  };
  return { root, raw, source, entry, data, output, convert };
}

describe("native absolute V8 source paths", () => {
  it("converts a real capture without losing an uncovered TypeScript CommonJS body", async () => {
    const { convert, output } = fixture();
    await convert();
    const report = parseLcovFull(readFileSync(output, "utf8")).get("fixture.cts")!;
    expect(report.lines.get(1)).toBeGreaterThan(0);
    expect(report.lines.get(3)).toBe(0);
    expect(report.lines.get(5)).toBeGreaterThan(0);
  });

  it("does not resolve a relative capture entry against the checkout", async () => {
    const { entry, convert } = fixture();
    entry.url = "fixture.cts";
    await expect(convert()).rejects.toThrow("no included sources");
  });

  it("does not include an absolute path outside the source root", async () => {
    const { root, entry, convert } = fixture();
    entry.url = `${root}-outside/fixture.cts`;
    await expect(convert()).rejects.toThrow("no included sources");
  });

  it("honors the same exclusions for native paths as file URLs", async () => {
    const { convert } = fixture();
    await expect(convert(["fixture.cts"])).rejects.toThrow("no included sources");
  });

  it("rejects an absolute source path with a NUL before replacing output", async () => {
    const { entry, data, output, convert } = fixture();
    data.result.push({ ...entry, url: entry.url + "\0" });
    writeFileSync(output, "existing report\n");
    await expect(convert()).rejects.toThrow("invalid source path");
    expect(readFileSync(output, "utf8")).toBe("existing report\n");
  });

  it("rejects a native path whose symlink resolves outside the source root", async () => {
    const { root, source, entry, convert } = fixture();
    const outside = mkdtempSync(join(tmpdir(), "coverage-check-native-path-outside-"));
    directories.push(outside);
    const target = join(outside, "outside.cts");
    writeFileSync(target, source);
    symlinkSync(target, join(root, "linked.cts"));
    entry.url = join(root, "linked.cts");
    await expect(convert()).rejects.toThrow("outside source root");
  });
});

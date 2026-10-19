import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseExecutedSource } from "./native-v8-source.mts";

const boundary = vi.hoisted(() => ({ noPackages: false, compileError: null as Error | null }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (boundary.noPackages && String(args[0]).endsWith("package.json")) {
        throw Object.assign(new Error("No package scope"), { code: "ENOENT" });
      }
      return actual.readFileSync(...args);
    },
  };
});

vi.mock("node:vm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:vm")>();
  return {
    ...actual,
    compileFunction: (...args: Parameters<typeof actual.compileFunction>) => {
      if (boundary.compileError) throw boundary.compileError;
      return actual.compileFunction(...args);
    },
  };
});

const directories: string[] = [];
afterEach(() => {
  boundary.noPackages = false;
  boundary.compileError = null;
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "coverage-check-module-boundary-"));
  directories.push(root);
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "package.json"), "{}");
  const file = join(root, "nested", "fixture.js");
  writeFileSync(file, "const value = 1");
  return file;
}

describe("native source classification boundaries", () => {
  it("uses CommonJS syntax detection when no ancestor declares a package scope", () => {
    const file = fixture();
    boundary.noPackages = true;
    expect(parseExecutedSource("with ({ value: 1 }) { void value }", file).sourceType).toBe(
      "script",
    );
  });

  it("preserves a compiler infrastructure failure instead of treating it as module syntax", () => {
    const file = fixture();
    boundary.compileError = new Error("compiler unavailable");
    expect(() => parseExecutedSource("const value = 1", file)).toThrow(
      expect.objectContaining({ cause: boundary.compileError }),
    );
  });
});

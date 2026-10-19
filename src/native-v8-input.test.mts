import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertNativeV8Inputs,
  assertPreservedOffsets,
  requireTypeStripper,
} from "./native-v8-input.mts";

describe("native V8 TypeScript input compatibility", () => {
  it("rejects malformed function metadata before the reporter can omit it", () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-check-native-input-"));
    const valid = {
      functionName: "f",
      isBlockCoverage: true,
      ranges: [{ startOffset: 0, endOffset: 1, count: 1 }],
    };
    try {
      for (const invalid of [
        null,
        "f",
        {},
        { ...valid, functionName: 2 },
        { ...valid, isBlockCoverage: 2 },
      ]) {
        writeFileSync(
          join(dir, "coverage-owned.json"),
          JSON.stringify({ result: [{ url: "file:///owned.mts", functions: [invalid] }] }),
        );
        expect(() => assertNativeV8Inputs(dir)).toThrow("invalid Node V8 coverage file");
      }
      writeFileSync(
        join(dir, "coverage-owned.json"),
        JSON.stringify({ result: [{ url: "file:///owned.mts", functions: [valid] }] }),
      );
      expect(() => assertNativeV8Inputs(dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a directory with no coverage even when unrelated files exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "coverage-check-native-input-"));
    try {
      writeFileSync(join(dir, "readme.txt"), "no capture\n");
      expect(() => assertNativeV8Inputs(dir)).toThrow("no Node V8 coverage files");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires a Node type stripper at runtime", () => {
    expect(() => requireTypeStripper(undefined)).toThrow("stripTypeScriptTypes support");
    const strip = (_source: string) => "stripped";
    expect(requireTypeStripper(strip)).toBe(strip);
  });

  it("preserves UTF-16 length and both CRLF positions", () => {
    expect(() => assertPreservedOffsets("🌕\r\ntype", "🌕\r\n    ", "fixture.mts")).not.toThrow();
    for (const stripped of ["🌕\r\n", "🌕 \ntype", "🌕\n\ntype"]) {
      expect(() => assertPreservedOffsets("🌕\r\ntype", stripped, "fixture.mts")).toThrow(
        "changed source offsets",
      );
    }
    expect(() => assertPreservedOffsets("a b", "a\nb", "fixture.mts")).toThrow(
      "changed source offsets",
    );
  });
});

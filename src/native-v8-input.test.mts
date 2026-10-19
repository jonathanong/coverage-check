import { describe, expect, it } from "vitest";
import { assertPreservedOffsets, requireTypeStripper } from "./native-v8-input.mts";

describe("native V8 TypeScript input compatibility", () => {
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

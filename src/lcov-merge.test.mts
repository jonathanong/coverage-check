import { describe, expect, it } from "vitest";
import { parseLcov } from "./lcov-parser.mts";
import { mergeLcov, toLcov } from "./lcov-merge.mts";

describe("mergeLcov", () => {
  it("merges two reports by summing hit counts", () => {
    const a = parseLcov(`SF:web/foo.mts\nDA:1,1\nDA:2,0\nend_of_record\n`);
    const b = parseLcov(`SF:web/foo.mts\nDA:1,2\nDA:3,1\nend_of_record\n`);
    const merged = mergeLcov([a, b]);
    const lines = merged.get("web/foo.mts")!;
    expect(lines.get(1)).toBe(3);
    expect(lines.get(2)).toBe(0);
    expect(lines.get(3)).toBe(1);
  });

  it("includes files present in only one report", () => {
    const a = parseLcov(`SF:backend/a.mts\nDA:1,1\nend_of_record\n`);
    const b = parseLcov(`SF:backend/b.mts\nDA:2,1\nend_of_record\n`);
    const merged = mergeLcov([a, b]);
    expect(merged.has("backend/a.mts")).toBe(true);
    expect(merged.has("backend/b.mts")).toBe(true);
  });

  it("handles a shard that did not execute a given file", () => {
    const a = parseLcov(`SF:backend/service.mts\nDA:10,1\nend_of_record\n`);
    const b = parseLcov(`SF:backend/other.mts\nDA:1,1\nend_of_record\n`);
    const merged = mergeLcov([a, b]);
    expect(merged.get("backend/service.mts")?.get(10)).toBe(1);
  });

  it("returns empty map for empty input", () => {
    expect(mergeLcov([])).toEqual(new Map());
  });
});

describe("toLcov", () => {
  it("serializes an empty map to an empty string", () => {
    expect(toLcov(new Map())).toBe("");
  });

  it("round-trips through parseLcov", () => {
    const original = parseLcov(`SF:backend/foo.mts\nDA:1,2\nDA:3,0\nend_of_record\n`);
    const text = toLcov(original);
    const roundTripped = parseLcov(text);
    expect(roundTripped.get("backend/foo.mts")?.get(1)).toBe(2);
    expect(roundTripped.get("backend/foo.mts")?.get(3)).toBe(0);
  });

  it("serializes multiple files", () => {
    const data = parseLcov(`SF:a.mts\nDA:1,1\nend_of_record\nSF:b.mts\nDA:2,3\nend_of_record\n`);
    const text = toLcov(data);
    expect(text).toContain("SF:a.mts");
    expect(text).toContain("SF:b.mts");
    expect(text).toContain("DA:1,1");
    expect(text).toContain("DA:2,3");
  });
});

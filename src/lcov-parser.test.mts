import { describe, expect, it } from "vitest";
import { parseLcov } from "./lcov-parser.mts";

const SIMPLE_LCOV = `
SF:web/components/Foo.tsx
DA:1,1
DA:2,0
DA:3,1
end_of_record
SF:web/components/Bar.tsx
DA:10,2
end_of_record
`;

const ABSOLUTE_LCOV = `
SF:/home/runner/work/repo/repo/web/lib/api/client.mts
DA:5,1
DA:6,0
end_of_record
`;

const WINDOWS_LCOV = `
SF:.\\backend\\services\\foo.mts
DA:1,1
end_of_record
`;

describe("parseLcov", () => {
  it("parses basic SF and DA records", () => {
    const result = parseLcov(SIMPLE_LCOV);
    expect(result.get("web/components/Foo.tsx")?.get(1)).toBe(1);
    expect(result.get("web/components/Foo.tsx")?.get(2)).toBe(0);
    expect(result.get("web/components/Bar.tsx")?.get(10)).toBe(2);
  });

  it("strips provided prefix from absolute paths", () => {
    const result = parseLcov(ABSOLUTE_LCOV, ["/home/runner/work/repo/repo/"]);
    expect(result.has("web/lib/api/client.mts")).toBe(true);
    expect(result.get("web/lib/api/client.mts")?.get(5)).toBe(1);
  });

  it("auto-strips GitHub Actions _work shape without explicit prefix", () => {
    const lcov = `SF:/home/runner/work/repo-name/repo-name/src/api.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcov(lcov);
    expect(result.has("src/api.mts")).toBe(true);
  });

  it("auto-strips custom runner _work shape", () => {
    const lcov = `SF:/mnt/data/_work/my-project/my-project/src/index.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcov(lcov);
    expect(result.has("src/index.mts")).toBe(true);
  });

  it("auto-strips Windows GitHub Actions _work shape", () => {
    const lcov = `SF:D:\\a\\_work\\repo-name\\repo-name\\src\\api.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcov(lcov);
    expect(result.has("src/api.mts")).toBe(true);
  });

  it("does not strip absolute paths that do not match the _work pattern", () => {
    const lcov = `SF:/absolute/path/to/file.mts\nDA:1,1\nend_of_record\n`;
    const result = parseLcov(lcov);
    expect(result.has("/absolute/path/to/file.mts")).toBe(true);
  });

  it("normalizes Windows backslash separators", () => {
    const result = parseLcov(WINDOWS_LCOV);
    expect(result.has("backend/services/foo.mts")).toBe(true);
  });

  it("strips leading ./ from SF paths", () => {
    const lcov = `SF:./web/components/Baz.tsx\nDA:1,1\nend_of_record\n`;
    const result = parseLcov(lcov);
    expect(result.has("web/components/Baz.tsx")).toBe(true);
  });

  it("handles missing end_of_record gracefully", () => {
    const lcov = `SF:web/foo.mts\nDA:1,1\n`;
    const result = parseLcov(lcov);
    expect(result.get("web/foo.mts")?.get(1)).toBe(1);
  });

  it("sums hits when the same file appears multiple times (shard merge)", () => {
    const lcov = `
SF:web/components/Foo.tsx
DA:1,2
end_of_record
SF:web/components/Foo.tsx
DA:1,3
DA:2,1
end_of_record
`;
    const result = parseLcov(lcov);
    expect(result.get("web/components/Foo.tsx")?.get(1)).toBe(5);
    expect(result.get("web/components/Foo.tsx")?.get(2)).toBe(1);
  });

  it("discards Vitest empty-report placeholder records", () => {
    const lcov = `SF:src/unrun.ts\nFN:1,(empty-report)\nDA:1,0\nend_of_record\n`;
    expect(parseLcov(lcov).has("src/unrun.ts")).toBe(false);
  });

  it("keeps a genuine record when an empty placeholder for the same file follows it", () => {
    const lcov = `SF:src/run.ts\nDA:1,2\nend_of_record\nSF:src/run.ts\nFN:1,(empty-report)\nDA:1,0\nend_of_record\n`;
    expect(parseLcov(lcov).get("src/run.ts")?.get(1)).toBe(2);
  });

  it("skips DA lines with malformed content (no comma)", () => {
    const lcov = `SF:web/foo.mts\nDA:badline\nDA:1,1\nend_of_record\n`;
    const result = parseLcov(lcov);
    expect(result.get("web/foo.mts")?.get(1)).toBe(1);
    expect(result.get("web/foo.mts")?.size).toBe(1);
  });

  it("skips DA lines with non-finite values", () => {
    const lcov = `SF:web/foo.mts\nDA:NaN,1\nDA:1,1\nend_of_record\n`;
    const result = parseLcov(lcov);
    expect(result.get("web/foo.mts")?.get(1)).toBe(1);
  });
});

it("handles CRLF line endings without leaving trailing carriage returns", () => {
  const lcovData = parseLcov("SF:foo.ts\r\nDA:1,1\r\nend_of_record\r\n");
  expect(lcovData.has("foo.ts")).toBe(true);
});

it("handles end equals -1 (last line without newline)", () => {
  const lcovData = parseLcov("SF:foo.ts\nDA:1,1\nend_of_record");
  expect(lcovData.has("foo.ts")).toBe(true);
});

it("trims trailing whitespace in SF and end_of_record lines", () => {
  const lcovData = parseLcov("SF:web/foo.ts  \nDA:1,1\nend_of_record   \r\n");
  expect(lcovData.has("web/foo.ts")).toBe(true);
  expect(lcovData.get("web/foo.ts")?.get(1)).toBe(1);
});

it("handles CRLF markers with trailing whitespace", () => {
  const lcovData = parseLcov("SF:foo.ts\r\nDA:1,1\r\nend_of_record  \r\n");
  expect(lcovData.has("foo.ts")).toBe(true);
  expect(lcovData.get("foo.ts")?.get(1)).toBe(1);
});

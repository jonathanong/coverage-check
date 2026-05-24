import { describe, expect, it } from "vitest";
import { forEachTrimmedLine } from "./for-each-line.mts";

describe("forEachTrimmedLine", () => {
  it("visits each line and trims trailing whitespace", () => {
    const input = "a  \n b\t\nc\r\n";
    const lines: string[] = [];

    forEachTrimmedLine(input, (line) => lines.push(line));

    expect(lines).toEqual(["a", " b", "c"]);
  });

  it("handles empty input", () => {
    const lines: string[] = [];
    forEachTrimmedLine("", (line) => lines.push(line));
    expect(lines).toEqual([]);
  });

  it("handles last line without a newline", () => {
    const lines: string[] = [];
    forEachTrimmedLine("foo  \nbar\t", (line) => lines.push(line));
    expect(lines).toEqual(["foo", "bar"]);
  });
});

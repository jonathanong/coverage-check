import { describe, expect, it } from "vitest";
import { parseArgs } from "./parse-args.mts";

describe("parseArgs", () => {
  it("parses string, boolean, and repeatable options", () => {
    expect(
      parseArgs<{ output: string; verbose: boolean; include: string[] }>(
        ["--output", "out.txt", "--verbose", "--include", "a", "--include", "b"],
        {
          output: { type: "string" },
          verbose: { type: "boolean", default: false },
          include: { type: "string", multiple: true, default: [] },
        },
      ),
    ).toEqual({ output: "out.txt", verbose: true, include: ["a", "b"] });
  });

  it("formats unknown options like the legacy parsers", () => {
    expect(() => parseArgs(["--wat"], {})).toThrow("unknown flag: --wat");
  });

  it("formats missing values like the legacy parsers", () => {
    expect(() => parseArgs(["--output"], { output: { type: "string" } })).toThrow(
      "--output requires a value",
    );
  });

  it("formats ambiguous option values like missing values", () => {
    expect(() =>
      parseArgs(["--output", "--next"], {
        output: { type: "string" },
        next: { type: "boolean" },
      }),
    ).toThrow("--output requires a value");
  });

  it("passes through unexpected parseArgs validation errors", () => {
    expect(() =>
      parseArgs([], { output: { type: "number" } as unknown as { type: "string" } }),
    ).toThrow("options.output.type");
  });
});

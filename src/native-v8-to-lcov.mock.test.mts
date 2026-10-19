import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertNativeV8ToLcov } from "./native-v8-to-lcov.mts";

const reporter = vi.hoisted(() => ({
  mode: "normal" as "normal" | "missing" | "empty" | "duplicate" | "outside" | "omitted",
}));
const sourceMutation = vi.hoisted(() => ({ enabled: false, calls: 0 }));

vi.mock("ast-v8-to-istanbul", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ast-v8-to-istanbul")>();
  return {
    ...actual,
    convert: async (options: Parameters<typeof actual.convert>[0]) => {
      const result = await actual.convert(options);
      if (sourceMutation.enabled && sourceMutation.calls++ === 0) {
        const { writeFileSync } = await import("node:fs");
        const { fileURLToPath } = await import("node:url");
        writeFileSync(fileURLToPath(options.coverage.url), "const changed: number = 3\n");
      }
      return result;
    },
  };
});

// This is the published reporter boundary; the real AST converter and coverage map still run.
vi.mock("istanbul-reports", () => ({
  default: {
    create: (_format: string, options: { projectRoot: string }) => ({
      execute: (context: { dir: string }) => {
        if (reporter.mode === "missing") return;
        const paths = reporter.mode === "omitted" ? ["first.mts"] : ["first.mts", "second.mts"];
        if (reporter.mode === "duplicate") paths.push("first.mts");
        if (reporter.mode === "outside") paths.push("../foreign.mts");
        if (reporter.mode === "empty") paths.length = 0;
        expect(options.projectRoot).toContain("coverage-check-reporter-fault-");
        writeFileSync(
          join(context.dir, "lcov.info"),
          paths.map((path) => `SF:${path}\nDA:1,1\nend_of_record\n`).join(""),
        );
      },
    }),
  },
}));

const directories: string[] = [];

afterEach(() => {
  reporter.mode = "normal";
  sourceMutation.enabled = false;
  sourceMutation.calls = 0;
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function ownedRawCapture(repeatFirst = false): { root: string; v8Dir: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), "coverage-check-reporter-fault-"));
  directories.push(root);
  const v8Dir = join(root, "raw-v8");
  mkdirSync(v8Dir);
  const result = ["first.mts", "second.mts"].map((file, index) => {
    const source = `const value${index}: number = ${index}\n`;
    writeFileSync(join(root, file), source);
    return {
      url: pathToFileURL(join(root, file)).href,
      functions: [
        {
          functionName: "",
          isBlockCoverage: true,
          ranges: [{ startOffset: 0, endOffset: source.length, count: 1 }],
        },
      ],
    };
  });
  if (repeatFirst) result.push(result[0]!);
  writeFileSync(join(v8Dir, "coverage-owned.json"), JSON.stringify({ result }));
  return { root, v8Dir, output: join(root, "published.lcov.info") };
}

describe("native V8 reporter output boundary", () => {
  it.each([
    ["missing", "did not produce LCOV"],
    ["empty", "no included sources"],
    ["duplicate", "duplicate LCOV sources"],
    ["outside", "outside the requested source scope"],
    ["omitted", "omitted one or more included V8 sources"],
  ] as const)(
    "rejects %s reporter output before replacing a prior report",
    async (mode, message) => {
      const { root, v8Dir, output } = ownedRawCapture();
      reporter.mode = mode;
      writeFileSync(output, "old report\n");
      await expect(
        convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["*.mts"], output }),
      ).rejects.toThrow(message);
      expect(readFileSync(output, "utf8")).toBe("old report\n");
    },
  );

  it("rejects a checkout source change between captures of one URL", async () => {
    const { root, v8Dir, output } = ownedRawCapture(true);
    sourceMutation.enabled = true;
    writeFileSync(output, "old report\n");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["*.mts"], output }),
    ).rejects.toThrow("source changed between captures");
    expect(readFileSync(output, "utf8")).toBe("old report\n");
  });
});

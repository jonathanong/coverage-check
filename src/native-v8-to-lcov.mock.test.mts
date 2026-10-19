import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertNativeV8ToLcov } from "./native-v8-to-lcov.mts";

type FakeEntry = { url: string; source: string; sourceMap?: object };
type ReporterOptions = {
  dataDir: string;
  outputDir: string;
  baseDir: string;
  entryFilter: (entry: FakeEntry) => boolean;
  onEntry: (entry: FakeEntry) => void;
};

const reporter = vi.hoisted(() => ({
  mode: "normal" as "normal" | "source-mismatch" | "source-map" | "outside" | "omitted",
}));

vi.mock("monocart-coverage-reports", () => ({
  default: {
    CoverageReport: class {
      private readonly options: ReporterOptions;

      constructor(options: ReporterOptions) {
        this.options = options;
      }

      async generate(): Promise<void> {
        const filename = readdirSync(this.options.dataDir).find((name) =>
          name.startsWith("coverage-"),
        )!;
        const raw = JSON.parse(readFileSync(join(this.options.dataDir, filename), "utf8"));
        const included: FakeEntry[] = [];
        for (const item of raw.result as Array<{ url: string }>) {
          if (!this.options.entryFilter(item as FakeEntry)) continue;
          const entry: FakeEntry = {
            url: item.url,
            source: readFileSync(fileURLToPath(item.url), "utf8"),
          };
          if (reporter.mode === "source-mismatch") entry.source += "// stale cache\n";
          if (reporter.mode === "source-map") entry.sourceMap = {};
          this.options.onEntry(entry);
          included.push(entry);
        }
        mkdirSync(this.options.outputDir, { recursive: true });
        const paths = included.map((entry) =>
          relative(this.options.baseDir, fileURLToPath(entry.url)).replaceAll("\\", "/"),
        );
        const reported = reporter.mode === "omitted" ? paths.slice(0, 1) : paths;
        if (reporter.mode === "outside") reported.push("outside.mts");
        writeFileSync(
          join(this.options.outputDir, "lcov.info"),
          reported.map((path) => `SF:${path}\nDA:1,1\nend_of_record\n`).join(""),
        );
      }
    },
  },
}));

const directories: string[] = [];

afterEach(() => {
  reporter.mode = "normal";
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function ownedRawCapture(files: string[]): { root: string; v8Dir: string; output: string } {
  const root = mkdtempSync(join(tmpdir(), "coverage-check-reporter-fault-"));
  directories.push(root);
  const v8Dir = join(root, "raw-v8");
  mkdirSync(v8Dir);
  const result = files.map((file, index) => {
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
  writeFileSync(join(v8Dir, "coverage-owned.json"), JSON.stringify({ result }));
  return { root, v8Dir, output: join(root, "published.lcov.info") };
}

describe("native V8 reporter fault boundary", () => {
  it.each([
    ["source-mismatch", "differs from the checkout"],
    ["source-map", "source map is unsupported"],
    ["outside", "outside the requested source scope"],
  ] as const)("rejects %s without replacing a prior report", async (mode, message) => {
    const { root, v8Dir, output } = ownedRawCapture(["fixture.mts"]);
    reporter.mode = mode;
    writeFileSync(output, "old report\n");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["fixture.mts"], output }),
    ).rejects.toThrow(message);
    expect(readFileSync(output, "utf8")).toBe("old report\n");
  });

  it("rejects an omitted included source before replacing output", async () => {
    const { root, v8Dir, output } = ownedRawCapture(["first.mts", "second.mts"]);
    reporter.mode = "omitted";
    writeFileSync(output, "old report\n");
    await expect(
      convertNativeV8ToLcov({ v8Dir, sourceRoot: root, include: ["*.mts"], output }),
    ).rejects.toThrow("omitted one or more included V8 sources");
    expect(readFileSync(output, "utf8")).toBe("old report\n");
  });
});

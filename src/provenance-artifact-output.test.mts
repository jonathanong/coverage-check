import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  replaceCoveragePairFiles,
  replaceProvenanceOutput,
} from "./provenance-artifact-output.mts";

describe("provenance artifact output replacement", () => {
  let root: string;
  let output: string;
  const pair = {
    suite: "web",
    lcov: Buffer.from("new"),
    manifestBytes: Buffer.from("{}"),
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "coverage-output-"));
    output = join(root, "output");
    mkdirSync(output);
    writeFileSync(join(output, "sentinel"), "preserved");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("preserves existing output when staging writes or the commit rename fail", () => {
    expect(() =>
      replaceProvenanceOutput(output, [pair], {
        write: () => {
          throw new Error("write failed");
        },
      }),
    ).toThrow("write failed");
    expect(readFileSync(join(output, "sentinel"), "utf8")).toBe("preserved");

    let renames = 0;
    expect(() =>
      replaceProvenanceOutput(output, [pair], {
        rename: (from, to) => {
          renames++;
          if (renames === 2) throw new Error("commit rename failed");
          renameSync(from, to);
        },
      }),
    ).toThrow("commit rename failed");
    expect(readFileSync(join(output, "sentinel"), "utf8")).toBe("preserved");
  });

  it("does not report failure after output commits when backup cleanup fails", () => {
    expect(() =>
      replaceProvenanceOutput(output, [pair], {
        remove: (path) => {
          if (path.includes("-backup-")) throw new Error("cleanup failed");
          rmSync(path, { recursive: true, force: true });
        },
      }),
    ).not.toThrow();
    expect(readFileSync(join(output, "coverage-web", "lcov.info"), "utf8")).toBe("new");
  });

  it("rolls back both pair files when staging or commit fails", () => {
    const lcovPath = join(root, "lcov.info");
    const manifestPath = join(root, "coverage-manifest.json");
    writeFileSync(lcovPath, "old-lcov");
    writeFileSync(manifestPath, "old-manifest");

    let writes = 0;
    expect(() =>
      replaceCoveragePairFiles(
        lcovPath,
        manifestPath,
        Buffer.from("new-lcov"),
        Buffer.from("new-manifest"),
        {
          write: (path, data, mode) => {
            writes++;
            if (writes === 2) throw new Error("manifest staging failed");
            writeFileSync(path, data, mode === undefined ? undefined : { mode });
          },
        },
      ),
    ).toThrow("manifest staging failed");
    expect(readFileSync(lcovPath, "utf8")).toBe("old-lcov");
    expect(readFileSync(manifestPath, "utf8")).toBe("old-manifest");

    let renames = 0;
    expect(() =>
      replaceCoveragePairFiles(
        lcovPath,
        manifestPath,
        Buffer.from("new-lcov"),
        Buffer.from("new-manifest"),
        {
          rename: (from, to) => {
            renames++;
            if (renames === 4) throw new Error("manifest commit failed");
            renameSync(from, to);
          },
        },
      ),
    ).toThrow("manifest commit failed");
    expect(readFileSync(lcovPath, "utf8")).toBe("old-lcov");
    expect(readFileSync(manifestPath, "utf8")).toBe("old-manifest");
  });

  it("preserves the commit and rollback errors when both fail", () => {
    let renames = 0;
    expect(() =>
      replaceProvenanceOutput(output, [pair], {
        remove: (path) => {
          if (path.includes("-staging-")) throw new Error("staging cleanup failed");
          rmSync(path, { recursive: true, force: true });
        },
        rename: (from, to) => {
          renames++;
          if (renames >= 2) throw new Error(`rename failed ${renames}`);
          renameSync(from, to);
        },
      }),
    ).toThrow(AggregateError);
  });

  it("requires pair files to be distinct and colocated", () => {
    const lcovPath = join(root, "lcov.info");
    expect(() =>
      replaceCoveragePairFiles(
        lcovPath,
        join(root, "other", "coverage-manifest.json"),
        Buffer.from("lcov"),
        Buffer.from("{}"),
      ),
    ).toThrow("distinct files in the same directory");
  });

  it("preserves pair commit and rollback errors together", () => {
    const lcovPath = join(root, "lcov.info");
    const manifestPath = join(root, "coverage-manifest.json");
    writeFileSync(lcovPath, "old-lcov");
    writeFileSync(manifestPath, "old-manifest");
    let renames = 0;

    expect(() =>
      replaceCoveragePairFiles(
        lcovPath,
        manifestPath,
        Buffer.from("new-lcov"),
        Buffer.from("new-manifest"),
        {
          rename: (from, to) => {
            renames++;
            if (renames >= 4) throw new Error(`rename failed ${renames}`);
            renameSync(from, to);
          },
        },
      ),
    ).toThrow(AggregateError);
  });
});

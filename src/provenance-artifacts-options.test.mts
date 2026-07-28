import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareProvenanceArtifacts } from "./provenance-artifacts.mts";

describe("provenance artifact fan-in options", () => {
  it("rejects an empty expected-suite set without replacing output", () => {
    const root = mkdtempSync(join(tmpdir(), "coverage-fan-in-options-"));
    const primary = join(root, "primary");
    const output = join(root, "output");
    mkdirSync(primary);
    mkdirSync(output);
    writeFileSync(join(output, "sentinel"), "preserved");

    try {
      expect(() =>
        prepareProvenanceArtifacts({
          root,
          sources: [{ name: "primary", directory: primary }],
          outputDirectory: output,
          expectedSuites: [],
          repository: "example/repository",
          revision: "a".repeat(40),
          expectedRun: null,
        }),
      ).toThrow("At least one expected coverage suite");
      expect(readFileSync(join(output, "sentinel"), "utf8")).toBe("preserved");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

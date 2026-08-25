import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePatchCoverageArtifacts } from "./patch-artifacts.mts";

const mocks = vi.hoisted(() => ({
  validatePatchCoverageContribution: vi.fn(),
  validatePatchCoveragePartitions: vi.fn(),
}));
vi.mock("./patch-contribution-validation.mts", () => mocks);
describe("preparePatchCoverageArtifacts", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    vi.clearAllMocks();
    mocks.validatePatchCoverageContribution.mockReset();
  });
  const manifest = (attempt = 1) => ({
    version: 2,
    kind: "patch-lcov",
    repository: "r",
    suite: "s",
    projects: ["p"],
    revision: "a".repeat(40),
    run: { id: "1", attempt },
    collector: { name: "v", version: "1", settings: {} },
    lcov: { bytes: 0, sha256: "a".repeat(64) },
    sourceRoot: {
      algorithm: "sha256-coverage-check-lcov-source-files-v1",
      files: 0,
      sha256: "a".repeat(64),
    },
    patch: {
      algorithm: "git-merge-base-diff-v1",
      base: "a".repeat(40),
      head: "a".repeat(40),
      changedLinesSha256: "a".repeat(64),
    },
    producer: { group: "g", index: 1, total: 1 },
  });
  const add = (source: string, suite: string = "s") => {
    const d = join(root, source, `coverage-${suite}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "lcov.info"), "");
    writeFileSync(join(d, "coverage-manifest.json"), "{}");
    return join(root, source);
  };
  const run = () =>
    preparePatchCoverageArtifacts({
      root,
      sources: [
        { name: "s3", directory: join(root, "s3") },
        { name: "gha", directory: join(root, "gha") },
      ],
      outputDirectory: join(root, "out"),
      repository: "r",
      revision: "a".repeat(40),
      run: { id: "1", currentAttempt: 2 },
      base: "a".repeat(40),
      head: "a".repeat(40),
      resolveDescriptor: (s) =>
        s === "s"
          ? { descriptor: { suite: "s", projects: ["p"], collector: { name: "v", settings: {} } } }
          : undefined,
    });
  it("unions identical sources and selects current attempt", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3");
    add("gha");
    mocks.validatePatchCoverageContribution.mockResolvedValue(manifest(2));
    await expect(run()).resolves.toMatchObject({
      selected: [{ suite: "s", sources: ["s3", "gha"] }],
    });
  });
  it("rejects conflicts, unknowns, and missing pairs", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3", "bad");
    await expect(run()).rejects.toThrow("Unexpected");
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3");
    mocks.validatePatchCoverageContribution
      .mockResolvedValueOnce(manifest(2))
      .mockResolvedValueOnce(manifest(2));
    add("gha");
    writeFileSync(join(root, "gha", "coverage-s", "lcov.info"), "different");
    await expect(run()).rejects.toThrow("conflicting");
  });
});

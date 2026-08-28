import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { preparePatchCoverageArtifacts } from "./patch-artifacts.mts";

const mocks = vi.hoisted(() => ({ validatePatchCoverageContribution: vi.fn() }));
vi.mock("./patch-contribution-validation.mts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./patch-contribution-validation.mts")>();
  return { ...actual, validatePatchCoverageContribution: mocks.validatePatchCoverageContribution };
});

describe("preparePatchCoverageArtifacts", () => {
  let root = "";
  const suites = new Set<string>();

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    suites.clear();
    vi.clearAllMocks();
    mocks.validatePatchCoverageContribution.mockReset();
  });

  const manifest = ({
    suite = "s",
    attempt = 1,
    group = "g",
    index = 1,
    total = 1,
  }: {
    suite?: string;
    attempt?: number;
    group?: string;
    index?: number;
    total?: number;
  } = {}) => ({
    version: 2,
    kind: "patch-lcov" as const,
    repository: "r",
    suite,
    projects: ["p"],
    revision: "a".repeat(40),
    run: { id: "1", attempt },
    collector: { name: "v", version: "1", settings: {} },
    lcov: { bytes: 0, sha256: "a".repeat(64) },
    sourceRoot: {
      algorithm: "sha256-coverage-check-lcov-source-files-v1" as const,
      files: 0,
      sha256: "a".repeat(64),
    },
    patch: {
      algorithm: "git-merge-base-diff-v1" as const,
      base: "a".repeat(40),
      head: "a".repeat(40),
      changedLinesSha256: "a".repeat(64),
    },
    producer: { group, index, total },
  });

  const add = (source: string, suite: string = "s") => {
    suites.add(suite);
    const directory = join(root, source, `coverage-${suite}`);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "lcov.info"), "");
    writeFileSync(join(directory, "coverage-manifest.json"), "{}");
  };

  const run = (expectedProducerGroups?: readonly string[]) =>
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
      expectedProducerGroups,
      resolveDescriptor: (suite) =>
        suites.has(suite)
          ? { descriptor: { suite, projects: ["p"], collector: { name: "v", settings: {} } } }
          : undefined,
    });

  it("unions identical sources and selects the latest attempt", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3");
    add("gha");
    mocks.validatePatchCoverageContribution
      .mockResolvedValueOnce(manifest({ attempt: 1 }))
      .mockResolvedValueOnce(manifest({ attempt: 2 }));

    await expect(run()).resolves.toMatchObject({
      selected: [{ suite: "s", sources: ["gha"], manifest: { run: { attempt: 2 } } }],
    });
  });

  it("rejects unexpected entries, unknown suites, missing pairs, and conflicts", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    const unexpectedEntry = join(root, "s3", "unexpected");
    mkdirSync(join(root, "s3"), { recursive: true });
    writeFileSync(unexpectedEntry, "");
    await expect(run()).rejects.toThrow("Unexpected");

    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    const bad = join(root, "s3", "coverage-bad");
    mkdirSync(bad, { recursive: true });
    await expect(run()).rejects.toThrow("Unexpected");

    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3");
    rmSync(join(root, "s3", "coverage-s", "coverage-manifest.json"));
    await expect(run()).rejects.toThrow("Missing patch coverage pair");

    rmSync(root, { recursive: true, force: true });
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3");
    add("gha");
    writeFileSync(join(root, "gha", "coverage-s", "lcov.info"), "different");
    mocks.validatePatchCoverageContribution.mockResolvedValue(manifest({ attempt: 2 }));
    await expect(run()).rejects.toThrow("conflicting");
  });

  it("prunes an unselected stale partial producer group after attempt selection", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3", "required");
    add("s3", "stale");
    add("s3", "short-a");
    add("s3", "short-b");
    const staleGroup = "s".repeat(100);
    mocks.validatePatchCoverageContribution.mockImplementation(({ descriptor }) =>
      Promise.resolve(
        descriptor.suite === "required"
          ? manifest({ suite: "required", attempt: 2, group: "required" })
          : descriptor.suite === "stale"
            ? manifest({ suite: "stale", attempt: 1, group: staleGroup, index: 1, total: 2 })
            : manifest({
                suite: descriptor.suite,
                attempt: 1,
                group: "short",
                index: descriptor.suite === "short-a" ? 1 : 2,
                total: 2,
              }),
      ),
    );
    const notice = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(run(["required"])).resolves.toMatchObject({
      selected: [{ suite: "required", manifest: { producer: { group: "required" } } }],
    });
    expect(existsSync(join(root, "out", "coverage-stale"))).toBe(false);
    expect(notice).toHaveBeenCalledTimes(2);
    expect(notice.mock.calls.map(([message]) => String(message))).toEqual(
      expect.arrayContaining([expect.stringContaining(`${"s".repeat(77)}...`)]),
    );
    expect(notice.mock.calls.map(([message]) => String(message))).toEqual(
      expect.arrayContaining([expect.stringContaining("short")]),
    );
    notice.mockRestore();
  });

  it("reuses a complete expected producer group from an earlier attempt", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3", "required");
    mocks.validatePatchCoverageContribution.mockResolvedValue(
      manifest({ suite: "required", attempt: 1, group: "required" }),
    );

    await expect(run(["required"])).resolves.toMatchObject({
      selected: [{ manifest: { run: { attempt: 1 }, producer: { group: "required" } } }],
    });
  });

  it("keeps expected earlier-attempt groups subject to partition validation", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3", "required");
    mocks.validatePatchCoverageContribution.mockResolvedValue(
      manifest({ suite: "required", attempt: 1, group: "required", index: 1, total: 2 }),
    );

    await expect(run(["required"])).rejects.toThrow("required is missing partitions");
  });

  it("rejects an unselected group with a current-attempt contribution", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3", "required");
    add("s3", "unexpected");
    mocks.validatePatchCoverageContribution.mockImplementation(({ descriptor }) =>
      Promise.resolve(
        descriptor.suite === "required"
          ? manifest({ suite: "required", attempt: 1, group: "required" })
          : manifest({ suite: "unexpected", attempt: 2, group: "unexpected" }),
      ),
    );

    await expect(run(["required"])).rejects.toThrow(
      "Unexpected current-attempt patch coverage producer group: unexpected",
    );
  });

  it("rejects an unselected group that did not predate the current attempt", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3", "unexpected");
    mocks.validatePatchCoverageContribution.mockResolvedValue(
      manifest({ suite: "unexpected", attempt: 3, group: "unexpected" }),
    );

    await expect(run([])).rejects.toThrow("Unexpected patch coverage producer group: unexpected");
  });

  it("rejects a missing expected producer group", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));

    await expect(run(["required"])).rejects.toThrow(
      "Missing expected patch coverage producer group: required",
    );
  });

  it("preserves strict partition validation when expected groups are omitted", async () => {
    root = mkdtempSync(join(tmpdir(), "patch-artifacts-"));
    add("s3", "required");
    add("s3", "stale");
    mocks.validatePatchCoverageContribution.mockImplementation(({ descriptor }) =>
      Promise.resolve(
        descriptor.suite === "required"
          ? manifest({ suite: "required", attempt: 2, group: "required" })
          : manifest({ suite: "stale", attempt: 1, group: "stale", index: 1, total: 2 }),
      ),
    );

    await expect(run()).rejects.toThrow("stale is missing partitions");
  });
});

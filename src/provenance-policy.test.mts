import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SelectedProvenanceArtifact } from "./provenance-artifact-types.mts";
import {
  expectedCollectorVersion,
  transportFromSources,
  validateSwiftCollectorVersions,
} from "./provenance-policy.mts";
import { SOURCE_ROOT_ALGORITHM } from "./provenance-types.mts";

function descriptor(name: string) {
  return { collector: { name, settings: {} } };
}

function selected(name: string, version: string, suite = "suite"): SelectedProvenanceArtifact {
  return {
    suite,
    sources: ["primary"],
    manifest: {
      version: 1,
      repository: "example/repo",
      suite,
      projects: ["p"],
      revision: "a".repeat(40),
      run: null,
      collector: { name, version, settings: {} },
      lcov: { bytes: 1, sha256: "0".repeat(64) },
      sourceRoot: { algorithm: SOURCE_ROOT_ALGORITHM, files: 1, sha256: "0".repeat(64) },
    },
  };
}

describe("expectedCollectorVersion", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  function vitestRoot(packageJson: unknown): string {
    const root = mkdtempSync(join(tmpdir(), "collector-version-"));
    roots.push(root);
    mkdirSync(join(root, "node_modules/vitest"), { recursive: true });
    writeFileSync(join(root, "node_modules/vitest/package.json"), JSON.stringify(packageJson));
    return root;
  }

  it("returns the caller-supplied Coverlet pin", () => {
    expect(
      expectedCollectorVersion("/unused", descriptor("coverlet"), { coverletVersion: "6.0.4" }),
    ).toBe("6.0.4");
  });

  it("rejects Coverlet when the caller omits the pin", () => {
    expect(() => expectedCollectorVersion("/unused", descriptor("coverlet"))).toThrow(
      /Coverlet collector version must be supplied/,
    );
  });

  it("rejects an empty Coverlet pin", () => {
    expect(() =>
      expectedCollectorVersion("/unused", descriptor("coverlet"), { coverletVersion: "" }),
    ).toThrow(/Coverlet collector version must be supplied/);
  });

  it("leaves llvm-cov unpinned so producers report their own version", () => {
    expect(expectedCollectorVersion("/unused", descriptor("llvm-cov"))).toBeUndefined();
  });

  it("reads the installed Vitest version for vitest-v8", () => {
    const root = vitestRoot({ version: "4.1.10" });
    expect(expectedCollectorVersion(root, descriptor("vitest-v8"))).toBe("4.1.10");
  });

  it("fails when the installed Vitest package omits its version", () => {
    const root = vitestRoot({});
    expect(() => expectedCollectorVersion(root, descriptor("vitest-v8"))).toThrow(
      /does not expose a version/,
    );
  });

  it("fails when the installed Vitest version is empty", () => {
    const root = vitestRoot({ version: "" });
    expect(() => expectedCollectorVersion(root, descriptor("vitest-v8"))).toThrow(
      /does not expose a version/,
    );
  });

  it("fails when the installed Vitest version is not a string", () => {
    const root = vitestRoot({ version: 4 });
    expect(() => expectedCollectorVersion(root, descriptor("vitest-v8"))).toThrow(
      /does not expose a version/,
    );
  });

  it("rejects an unknown collector name", () => {
    expect(() => expectedCollectorVersion("/unused", descriptor("istanbul"))).toThrow(
      /Unknown coverage collector: istanbul/,
    );
  });
});

describe("validateSwiftCollectorVersions", () => {
  it("accepts an empty selection", () => {
    expect(() => validateSwiftCollectorVersions([])).not.toThrow();
  });

  it("accepts selections that include no llvm-cov suites", () => {
    expect(() =>
      validateSwiftCollectorVersions([
        selected("vitest-v8", "4.1.10", "web"),
        selected("coverlet", "6.0.4", "dotnet"),
      ]),
    ).not.toThrow();
  });

  it("accepts a single llvm-cov suite", () => {
    expect(() => validateSwiftCollectorVersions([selected("llvm-cov", "LLVM 18.1")])).not.toThrow();
  });

  it("accepts multiple llvm-cov suites that report the same version", () => {
    expect(() =>
      validateSwiftCollectorVersions([
        selected("llvm-cov", "LLVM 18.1", "swift-core"),
        selected("llvm-cov", "LLVM 18.1", "swift-ui"),
        selected("vitest-v8", "4.1.10", "web"),
      ]),
    ).not.toThrow();
  });

  it("rejects llvm-cov suites that report different versions", () => {
    expect(() =>
      validateSwiftCollectorVersions([
        selected("llvm-cov", "LLVM 18.1", "swift-core"),
        selected("llvm-cov", "LLVM 18.2", "swift-ui"),
      ]),
    ).toThrow(/inconsistent llvm-cov versions/);
  });
});

describe("transportFromSources", () => {
  it("maps a single primary or fallback source", () => {
    expect(transportFromSources(["primary"])).toBe("primary");
    expect(transportFromSources(["fallback"])).toBe("fallback");
  });

  it("maps a matching dual-source selection regardless of order", () => {
    expect(transportFromSources(["primary", "fallback"])).toBe("both");
    expect(transportFromSources(["fallback", "primary"])).toBe("both");
  });

  it.each([
    [[], ""],
    [["unexpected"], "unexpected"],
    [["primary", "primary"], "primary, primary"],
    [["primary", "fallback", "extra"], "primary, fallback, extra"],
  ] as const)("rejects %j", (sources, joined) => {
    expect(() => transportFromSources(sources)).toThrow(
      `Coverage source selection invariant failed: ${joined}`,
    );
  });
});

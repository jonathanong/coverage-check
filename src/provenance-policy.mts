import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CoverageArtifactDescriptor } from "./provenance-types.mts";

export type ExpectedCollectorVersionOptions = {
  readonly coverletVersion?: string;
};

export function expectedCollectorVersion(
  root: string,
  descriptor: Pick<CoverageArtifactDescriptor, "collector">,
  options: ExpectedCollectorVersionOptions = {},
): string | undefined {
  switch (descriptor.collector.name) {
    case "coverlet": {
      if (typeof options.coverletVersion !== "string" || options.coverletVersion.length === 0) {
        throw new Error("Coverlet collector version must be supplied by the caller");
      }
      return options.coverletVersion;
    }
    case "llvm-cov":
      return undefined;
    case "vitest-v8": {
      const packagePath = resolve(root, "node_modules/vitest/package.json");
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
      if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
        throw new Error("Installed Vitest package does not expose a version");
      }
      return packageJson.version;
    }
    default:
      throw new Error(`Unknown coverage collector: ${descriptor.collector.name}`);
  }
}

export function validateSwiftCollectorVersions(
  selected: readonly { manifest: { collector: { name: string; version: string } } }[],
): void {
  const swiftVersions = new Set<string>();
  for (const { manifest } of selected) {
    if (manifest.collector.name === "llvm-cov") {
      swiftVersions.add(manifest.collector.version);
    }
  }
  if (swiftVersions.size > 1) {
    throw new Error("Selected Swift coverage suites use inconsistent llvm-cov versions");
  }
}

export function transportFromSources(sources: readonly string[]): "primary" | "fallback" | "both" {
  if (sources.length === 2 && sources.includes("primary") && sources.includes("fallback")) {
    return "both";
  }
  if (sources.length === 1 && (sources[0] === "primary" || sources[0] === "fallback")) {
    return sources[0];
  }
  throw new Error(`Coverage source selection invariant failed: ${sources.join(", ")}`);
}

import { readdirSync, readFileSync, rmSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { ExpectedSuite } from "./commands/prepare-artifacts.mts";
import type { ProvenanceArtifactSource } from "./provenance-artifact-types.mts";
import { COVERAGE_MANIFEST_FILENAME, parseCoverageManifest } from "./provenance.mts";
import type { ExpectedCoverageRun } from "./provenance-types.mts";

export interface PruneStaleEarlierAttemptSuitesOptions {
  readonly sources: readonly ProvenanceArtifactSource[];
  readonly expectedSuites: readonly ExpectedSuite[];
  readonly run: ExpectedCoverageRun;
}

const COVERAGE_DIR_PREFIX = "coverage-";

// Coverage sources are run-scoped and legitimately span attempts, but expectations are
// attempt-scoped. A suite that is unexpected because a later attempt's selection narrowed is
// provably stale, not invalid, so it is safe to remove before provenance inspection rejects it.
// Anything without that proof - a foreign run, the current attempt, or a manifest that cannot
// be read - is left in place for provenance inspection to hard-fail as before.
function isStaleEarlierAttempt(pairDir: string, run: ExpectedCoverageRun): boolean {
  try {
    const raw = readFileSync(join(pairDir, COVERAGE_MANIFEST_FILENAME), "utf8");
    const manifest = parseCoverageManifest(JSON.parse(raw));
    return (
      manifest.run !== null &&
      manifest.run.id === run.id &&
      manifest.run.attempt < run.currentAttempt
    );
  } catch {
    return false;
  }
}

export function pruneStaleEarlierAttemptSuites(
  options: PruneStaleEarlierAttemptSuitesOptions,
): readonly string[] {
  const expectedSuiteNames = new Set(options.expectedSuites.map(({ suite }) => suite));
  const pruned: string[] = [];
  for (const source of options.sources) {
    let entries: Dirent[];
    try {
      entries = readdirSync(source.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.name.startsWith(COVERAGE_DIR_PREFIX)) continue;
      if (!entry.isDirectory()) continue;
      const suite = entry.name.slice(COVERAGE_DIR_PREFIX.length);
      if (expectedSuiteNames.has(suite)) continue;
      const pairDir = join(source.directory, entry.name);
      if (!isStaleEarlierAttempt(pairDir, options.run)) continue;
      rmSync(pairDir, { recursive: true, force: true });
      pruned.push(suite);
      process.stdout.write(
        `::notice::Pruned stale earlier-attempt coverage suite from ${source.name}: ${suite}\n`,
      );
    }
  }
  return pruned;
}

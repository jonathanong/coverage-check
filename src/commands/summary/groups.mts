import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { load as loadYaml } from "js-yaml";
import { mergeLcov } from "../../lcov-merge.mts";
import type { LcovData, SourceCoverageGroup, SuiteCoverage } from "./types.mts";

type CoverageGroupDefinition = {
  folder: string;
  prefix: string;
};

const otherGroup: CoverageGroupDefinition = { folder: "other", prefix: "" };

type CoverageRulesFile = {
  rules?: Array<{
    paths?: string | string[];
  }>;
};

function isCoverageRulesFile(value: unknown): value is CoverageRulesFile {
  return typeof value === "object" && value !== null;
}

function staticFolderFromGlob(pattern: string): string | null {
  const normalized = pattern.replace(/\\/g, "/");
  const firstGlobIndex = normalized.search(/[*?[\]{}]/);
  const staticPrefix = firstGlobIndex === -1 ? normalized : normalized.slice(0, firstGlobIndex);
  const folder = staticPrefix.replace(/\/+$/, "");
  return folder === "" ? null : folder;
}

function loadCoverageGroupDefinitions(rulesFile?: string): CoverageGroupDefinition[] {
  const resolvedFile = rulesFile ?? path.join(process.cwd(), ".coverage-rules.yml");
  if (!existsSync(resolvedFile)) return [];
  const parsed = loadYaml(readFileSync(resolvedFile, "utf8"));
  const rules = isCoverageRulesFile(parsed) && Array.isArray(parsed.rules) ? parsed.rules : [];
  return rules.flatMap((rule) => {
    const paths = Array.isArray(rule.paths)
      ? rule.paths
      : rule.paths === undefined
        ? []
        : [rule.paths];
    return paths.flatMap((pattern) => {
      const folder = staticFolderFromGlob(pattern);
      return folder === null ? [] : [{ folder, prefix: `${folder}/` }];
    });
  });
}

function groupForFile(
  filePath: string,
  definitions: CoverageGroupDefinition[],
): CoverageGroupDefinition {
  const normalizedPath = filePath.replace(/\\/g, "/");
  return (
    definitions.find(
      (definition) =>
        normalizedPath === definition.folder || normalizedPath.startsWith(definition.prefix),
    ) ?? otherGroup
  );
}

export function groupSuitesBySourceFolder(
  suites: SuiteCoverage[],
  branch: string,
  rulesFile?: string,
): SourceCoverageGroup[] {
  const definitions = loadCoverageGroupDefinitions(rulesFile);
  const groups = new Map<
    string,
    {
      branch?: string;
      branches: Set<string>;
      current: boolean;
      history: boolean;
      reports: LcovData[];
    }
  >();

  for (const suite of suites) {
    const suiteReportsByGroup = new Map<string, LcovData>();
    for (const [filePath, lines] of suite.lcov.entries()) {
      const definition = groupForFile(filePath, definitions);
      const group = groups.get(definition.folder) ?? {
        branches: new Set<string>(),
        current: false,
        history: false,
        reports: [],
      };
      if (suite.source === "current") group.current = true;
      else {
        group.history = true;
        group.branches.add(suite.branch ?? branch);
      }
      const suiteReport = suiteReportsByGroup.get(definition.folder) ?? new Map();
      suiteReport.set(filePath, new Map(lines));
      suiteReportsByGroup.set(definition.folder, suiteReport);
      groups.set(definition.folder, group);
    }

    for (const [folder, report] of suiteReportsByGroup.entries()) {
      groups.get(folder)?.reports.push(report);
    }
  }

  const coverageGroups: SourceCoverageGroup[] = [];
  for (const definition of [...definitions, otherGroup]) {
    const group = groups.get(definition.folder);
    if (!group) continue;
    const coverageGroup: SourceCoverageGroup = {
      folder: definition.folder,
      source: group.current && group.history ? "mixed" : group.current ? "current" : "history",
      lcov: mergeLcov(group.reports),
    };
    if (group.branches.size > 0) {
      coverageGroup.branchesLabel = [...group.branches]
        .sort((a, b) => a.localeCompare(b))
        .join(", ");
    }
    coverageGroups.push(coverageGroup);
  }
  return coverageGroups;
}

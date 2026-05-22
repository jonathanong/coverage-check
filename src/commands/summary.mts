export {
  buildCoverageSummary,
  groupSuitesBySourceFolder,
  main,
  parseCoverageSummaryArgs,
  renderCoverageSummaryMarkdown,
  suiteTotals,
} from "./summary/index.mts";
export type { CoverageSummary, CoverageSummaryArgs, SuiteCoverage } from "./summary/index.mts";

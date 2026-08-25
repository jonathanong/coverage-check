import type { LcovData } from "./types.mts";

/** Merges multiple LcovData maps by summing hit counts per file per line. */
export function mergeLcov(reports: LcovData[]): LcovData {
  const merged: LcovData = new Map();

  for (const report of reports) {
    for (const [file, lines] of report) {
      let target = merged.get(file);
      if (target === undefined) {
        // Optimization: Use `new Map(lines)` instead of copying elements one by one.
        // This skips redundant iterations and reduces Map insertion overhead.
        target = new Map(lines);
        merged.set(file, target);
      } else {
        for (const [lineNo, hits] of lines) {
          target.set(lineNo, (target.get(lineNo) ?? 0) + hits);
        }
      }
    }
  }

  return merged;
}

/** Serializes LcovData back to LCOV text format. */
export function toLcov(lcov: LcovData): string {
  const lines: string[] = [];
  for (const [file, fileLines] of [...lcov].toSorted(([a], [b]) => a.localeCompare(b))) {
    lines.push(`SF:${file}`);
    for (const [lineNo, hits] of [...fileLines].toSorted(([a], [b]) => a - b)) {
      lines.push(`DA:${lineNo},${hits}`);
    }
    lines.push("end_of_record");
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

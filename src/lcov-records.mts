/**
 * Full-fidelity LCOV data for one source file.
 * Preserves function, branch, and line coverage records.
 */
export type FullFileCoverage = {
  /** FN: definitions keyed by function name. */
  functions: Map<string, { line: number; name: string }>;
  /** FNDA: hit counts keyed by function name. */
  functionHits: Map<string, number>;
  /** BRDA: hit counts keyed by "lineNo,blockNo,branchNo". */
  branches: Map<string, number>;
  /** DA: hit counts keyed by line number. */
  lines: Map<number, number>;
};

/** Map from normalized file path → full LCOV coverage data. */
export type FullLcovData = Map<string, FullFileCoverage>;

function normalizeSfPath(rawPath: string, stripPrefixes: string[]): string {
  let path = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const prefix of stripPrefixes) {
    if (path.startsWith(prefix)) return path.slice(prefix.length);
  }
  if (path.startsWith("/") || /^[A-Z]:\//i.test(path)) {
    const match = path.match(/^.*?\/_?work\/([^/]+)\/\1\//);
    if (match) return path.slice(match[0].length);
  }
  return path;
}

function getOrCreate(data: FullLcovData, file: string): FullFileCoverage {
  let cov = data.get(file);
  if (cov === undefined) {
    cov = { branches: new Map(), functionHits: new Map(), functions: new Map(), lines: new Map() };
    data.set(file, cov);
  }
  return cov;
}

function applyRecord(line: string, cov: FullFileCoverage): void {
  if (line.startsWith("FN:")) {
    const comma = line.indexOf(",", 3);
    if (comma === -1) return;
    const lineNum = parseInt(line.slice(3, comma), 10);
    const name = line.slice(comma + 1);
    if (Number.isFinite(lineNum) && name) cov.functions.set(name, { line: lineNum, name });
  } else if (line.startsWith("FNDA:")) {
    const comma = line.indexOf(",", 5);
    if (comma === -1) return;
    const hits = parseInt(line.slice(5, comma), 10);
    const name = line.slice(comma + 1);
    if (Number.isFinite(hits) && name)
      cov.functionHits.set(name, (cov.functionHits.get(name) ?? 0) + hits);
  } else if (line.startsWith("BRDA:")) {
    // Optimization: avoid allocating intermediate arrays with split(",")
    const rest = line.slice(5);
    const c1 = rest.indexOf(",");
    if (c1 === -1) return;
    const c2 = rest.indexOf(",", c1 + 1);
    if (c2 === -1) return;
    const c3 = rest.indexOf(",", c2 + 1);
    if (c3 === -1) return;

    const key = rest.slice(0, c3);

    // We only want exactly 4 values, matching what `split(",")` expects.
    let comma4 = rest.indexOf(",", c3 + 1);

    const raw = comma4 === -1 ? rest.slice(c3 + 1) : rest.slice(c3 + 1, comma4);

    // The previous implementation used `const parts = line.slice(5).split(",");`
    // and early returned if `parts.length !== 4`. However, `split()` drops trailing elements,
    // but its behavior in tests showed it might be less strict depending on other logic.
    // If we want strict equivalence to `parts.length !== 4`:
    if (comma4 !== -1) return;
    const hits = raw === "-" ? 0 : parseInt(raw, 10);
    if (Number.isFinite(hits)) cov.branches.set(key, (cov.branches.get(key) ?? 0) + hits);
  } else if (line.startsWith("DA:")) {
    const comma = line.indexOf(",", 3);
    if (comma === -1) return;
    const lineNum = parseInt(line.slice(3, comma), 10);
    const hits = parseInt(line.slice(comma + 1), 10);
    if (Number.isFinite(lineNum) && Number.isFinite(hits))
      cov.lines.set(lineNum, (cov.lines.get(lineNum) ?? 0) + hits);
  }
  // TN:, LF:, LH:, FNF:, FNH:, BRF:, BRH: are summary lines — recomputed by toLcovFull
}

/**
 * Parses full-fidelity LCOV, preserving FN/FNDA/BRDA/DA records.
 * Hits from repeated records for the same line/function/branch are summed.
 * Summary records (TN/LF/LH/FNF/FNH/BRF/BRH) are skipped and recomputed by toLcovFull.
 */
export function parseLcovFull(text: string, stripPrefixes: string[] = []): FullLcovData {
  const result: FullLcovData = new Map();
  let current: FullFileCoverage | null = null;
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    let lineEnd = end;
    while (lineEnd > start) {
      const c = text.charCodeAt(lineEnd - 1);
      if (c === 32 || c === 9 || c === 13) {
        lineEnd--;
        continue;
      }
      break;
    }
    if (text.startsWith("SF:", start)) {
      current = getOrCreate(result, normalizeSfPath(text.slice(start + 3, lineEnd), stripPrefixes));
    } else if (lineEnd - start === 13 && text.startsWith("end_of_record", start)) {
      current = null;
    } else if (current !== null) {
      applyRecord(text.slice(start, lineEnd), current);
    }
    start = end + 1;
  }
  return result;
}

/** Merges multiple FullLcovData maps by summing all hit counts per file/line/function/branch. */
export function mergeLcovFull(reports: FullLcovData[]): FullLcovData {
  const merged: FullLcovData = new Map();
  for (const report of reports) {
    for (const [file, cov] of report) {
      const target = merged.get(file);
      if (target === undefined) {
        merged.set(file, {
          functions: new Map(cov.functions),
          functionHits: new Map(cov.functionHits),
          branches: new Map(cov.branches),
          lines: new Map(cov.lines),
        });
      } else {
        for (const [name, def] of cov.functions) {
          if (!target.functions.has(name)) target.functions.set(name, def);
        }
        for (const [name, hits] of cov.functionHits)
          target.functionHits.set(name, (target.functionHits.get(name) ?? 0) + hits);
        for (const [key, hits] of cov.branches)
          target.branches.set(key, (target.branches.get(key) ?? 0) + hits);
        for (const [lineNum, hits] of cov.lines)
          target.lines.set(lineNum, (target.lines.get(lineNum) ?? 0) + hits);
      }
    }
  }
  return merged;
}

/** Serializes FullLcovData to LCOV text with recomputed FNF/FNH/BRF/BRH/LF/LH summaries. */
export function toLcovFull(lcov: FullLcovData): string {
  if (lcov.size === 0) return "";
  const out: string[] = [];
  for (const [file, cov] of [...lcov.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push("TN:", `SF:${file}`);
    const fns = [...cov.functions.values()].sort(
      (a, b) => a.line - b.line || a.name.localeCompare(b.name),
    );
    for (const fn of fns) out.push(`FN:${fn.line},${fn.name}`);
    const fnHits = [...cov.functionHits.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [name, hits] of fnHits) out.push(`FNDA:${hits},${name}`);
    out.push(`FNF:${cov.functions.size}`);
    out.push(`FNH:${[...cov.functionHits.values()].filter((h) => h > 0).length}`);
    const brs = [...cov.branches.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [key, hits] of brs) out.push(`BRDA:${key},${hits}`);
    out.push(`BRF:${cov.branches.size}`);
    out.push(`BRH:${[...cov.branches.values()].filter((h) => h > 0).length}`);
    const lines = [...cov.lines.entries()].sort(([a], [b]) => a - b);
    for (const [lineNum, hits] of lines) out.push(`DA:${lineNum},${hits}`);
    out.push(`LF:${cov.lines.size}`);
    out.push(`LH:${[...cov.lines.values()].filter((h) => h > 0).length}`);
    out.push("end_of_record");
  }
  return `${out.join("\n")}\n`;
}

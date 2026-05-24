type Loc = { start: { line: number; column: number }; end: { line: number; column: number } };

export type IstanbulFileCoverage = {
  path: string;
  statementMap: Record<string, Loc>;
  s: Record<string, number>;
  fnMap: Record<string, { name: string; decl: Loc; loc: Loc }>;
  f: Record<string, number>;
  branchMap: Record<string, { loc: Loc; type: string; locations: Loc[] }>;
  b: Record<string, number[]>;
};

export type IstanbulCoverage = Record<string, IstanbulFileCoverage>;

function loc(line: number): Loc {
  return { start: { line, column: 0 }, end: { line, column: 999 } };
}

function normalizeFilePath(filePath: string, stripPrefixes: string[]): string {
  const normalized = filePath.replace(/\\/g, "/");
  for (const prefix of stripPrefixes) {
    const p = prefix.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalized === p) return "";
    if (normalized.startsWith(`${p}/`)) return normalized.slice(p.length + 1);
  }
  return normalized;
}

export function lcovBufferToIstanbul(lcov: Buffer, stripPrefixes: string[]): IstanbulCoverage {
  const coverage: IstanbulCoverage = {};
  let filePath: string | null = null;
  const pendingFnLines = new Map<string, number>();
  // Accumulate branches at file scope so counts from all records for the same
  // file are merged before converting to Istanbul arrays.
  // filePath → blockKey → branchId → count
  const fileBranches = new Map<string, Map<string, Map<string, number>>>();

  function flush() {
    pendingFnLines.clear();
  }

  // Optimization: Instead of using `text.split("\n")` which allocates a massive
  // array of strings in memory and causes significant garbage collection overhead
  // for large LCOV files, we manually traverse the string using `indexOf("\n")`.
  // This reduces memory allocations and improves parsing speed.
  const text = lcov.toString("utf8");
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;

    let lineEnd = end;
    if (lineEnd > start && text.charCodeAt(lineEnd - 1) === 13) {
      lineEnd--;
    }

    const line = text.slice(start, lineEnd);
    start = end + 1;

    if (line === "end_of_record") {
      flush();
      filePath = null;
      continue;
    }
    if (line.startsWith("SF:")) {
      flush();
      filePath = normalizeFilePath(line.slice(3).trim(), stripPrefixes);
      if (filePath && !coverage[filePath]) {
        coverage[filePath] = {
          path: filePath,
          statementMap: {},
          s: {},
          fnMap: {},
          f: {},
          branchMap: {},
          b: {},
        };
      }
      continue;
    }
    if (!filePath) continue;
    const fileCov = coverage[filePath]!; // filePath was validated against coverage when SF: was processed

    if (line.startsWith("DA:")) {
      const [lineNo, hits] = line.slice(3).split(",", 2);
      const l = Number.parseInt(lineNo!, 10);
      const h = Number.parseInt(hits ?? "", 10);
      if (!Number.isInteger(l) || !Number.isInteger(h)) continue;
      const key = String(l);
      if (fileCov.statementMap[key] === undefined) {
        fileCov.statementMap[key] = loc(l);
        fileCov.s[key] = h;
      } else {
        fileCov.s[key] = (fileCov.s[key] as number) + h;
      }
    } else if (line.startsWith("FN:") || line.startsWith("FNL:")) {
      const rest = line.slice(line.startsWith("FNL:") ? 4 : 3);
      const firstComma = rest.indexOf(",");
      if (firstComma === -1) continue;
      const l = Number.parseInt(rest.slice(0, firstComma), 10);
      const afterFirst = rest.slice(firstComma + 1);
      // Handle both FN:start,name and FN:start,end,name (LCOV 2.x three-field form)
      const secondComma = afterFirst.indexOf(",");
      const name = secondComma === -1 ? afterFirst : afterFirst.slice(secondComma + 1);
      if (Number.isInteger(l) && name) pendingFnLines.set(name, l);
    } else if (line.startsWith("FNDA:") || line.startsWith("FNA:")) {
      const rest = line.slice(line.startsWith("FNA:") ? 4 : 5);
      const commaIdx = rest.indexOf(",");
      if (commaIdx === -1) continue;
      const h = Number.parseInt(rest.slice(0, commaIdx), 10);
      const name = rest.slice(commaIdx + 1);
      if (!Number.isInteger(h) || !name) continue;
      const startLine = pendingFnLines.get(name) ?? 0;
      const key = startLine > 0 ? `${name}@${startLine}` : name;
      const fnLoc = loc(startLine);
      if (fileCov.fnMap[key] === undefined) {
        fileCov.fnMap[key] = { name, decl: fnLoc, loc: fnLoc };
        fileCov.f[key] = h;
      } else {
        fileCov.f[key] = (fileCov.f[key] as number) + h;
      }
    } else if (line.startsWith("BRDA:")) {
      const parts = line.slice(5).split(",", 4);
      const lineNo = Number.parseInt(parts[0]!, 10);
      const blockId = parts[1] ?? "";
      const branchId = parts[2] ?? "";
      const taken = parts[3] === "-" ? 0 : Number.parseInt(parts[3] ?? "", 10);
      if (!Number.isInteger(lineNo) || !blockId || !branchId || !Number.isInteger(taken)) continue;
      const blockKey = `${lineNo}-${blockId}`;
      let fileBlocks = fileBranches.get(filePath);
      if (!fileBlocks) {
        fileBlocks = new Map();
        fileBranches.set(filePath, fileBlocks);
      }
      let blockBranches = fileBlocks.get(blockKey);
      if (!blockBranches) {
        blockBranches = new Map();
        fileBlocks.set(blockKey, blockBranches);
      }
      blockBranches.set(branchId, (blockBranches.get(branchId) ?? 0) + taken);
    }
  }
  flush();

  // Convert per-file branch accumulator to Istanbul branchMap/b arrays.
  // All records for a file are fully merged before sorting, so branchId
  // sets that differ across records are handled correctly.
  for (const [fp, blocks] of fileBranches) {
    const fileCov = coverage[fp]!; // fp was validated against coverage when added to fileBranches
    for (const [blockKey, branches] of blocks) {
      const lineNo = Number.parseInt(blockKey.split("-")[0]!, 10); // blockKey is always "N-blockId"
      const branchLoc = loc(lineNo);
      const sorted = [...branches.entries()].sort(([a], [b]) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
      fileCov.branchMap[blockKey] = {
        loc: branchLoc,
        type: "branch",
        locations: sorted.map(() => branchLoc),
      };
      fileCov.b[blockKey] = sorted.map(([, count]) => count);
    }
  }

  return coverage;
}

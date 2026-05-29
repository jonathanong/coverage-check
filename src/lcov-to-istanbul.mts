/* eslint-disable max-lines */
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

    if (lineEnd - start === 13 && text.startsWith("end_of_record", start)) {
      flush();
      filePath = null;
      start = end + 1;
      continue;
    }
    if (text.startsWith("SF:", start)) {
      flush();
      filePath = normalizeFilePath(text.slice(start + 3, lineEnd).trim(), stripPrefixes);
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
      start = end + 1;
      continue;
    }
    if (!filePath) {
      start = end + 1;
      continue;
    }
    const fileCov = coverage[filePath]!; // filePath was validated against coverage when SF: was processed

    if (text.startsWith("DA:", start)) {
      const commaIdx = text.indexOf(",", start + 3);
      const lineNoStr =
        commaIdx !== -1 && commaIdx < lineEnd
          ? text.slice(start + 3, commaIdx)
          : text.slice(start + 3, lineEnd);
      const hitsStr =
        commaIdx !== -1 && commaIdx < lineEnd ? text.slice(commaIdx + 1, lineEnd) : "";

      const l = Number.parseInt(lineNoStr, 10);
      const h = Number.parseInt(hitsStr, 10);
      if (!Number.isInteger(l) || !Number.isInteger(h)) {
        start = end + 1;
        continue;
      }
      const key = String(l);
      if (fileCov.statementMap[key] === undefined) {
        fileCov.statementMap[key] = loc(l);
        fileCov.s[key] = h;
      } else {
        fileCov.s[key] = (fileCov.s[key] as number) + h;
      }
    } else if (text.startsWith("FN:", start) || text.startsWith("FNL:", start)) {
      const restStart = start + (text.startsWith("FNL:", start) ? 4 : 3);
      const rest = text.slice(restStart, lineEnd);
      const firstComma = rest.indexOf(",");
      if (firstComma === -1) {
        start = end + 1;
        continue;
      }
      const l = Number.parseInt(rest.slice(0, firstComma), 10);
      const afterFirst = rest.slice(firstComma + 1);
      // Handle both FN:start,name and FN:start,end,name (LCOV 2.x three-field form)
      const secondComma = afterFirst.indexOf(",");
      const name = secondComma === -1 ? afterFirst : afterFirst.slice(secondComma + 1);
      if (Number.isInteger(l) && name) pendingFnLines.set(name, l);
    } else if (text.startsWith("FNDA:", start) || text.startsWith("FNA:", start)) {
      const restStart = start + (text.startsWith("FNA:", start) ? 4 : 5);
      const rest = text.slice(restStart, lineEnd);
      const commaIdx = rest.indexOf(",");
      if (commaIdx === -1) {
        start = end + 1;
        continue;
      }
      const h = Number.parseInt(rest.slice(0, commaIdx), 10);
      const name = rest.slice(commaIdx + 1);
      if (!Number.isInteger(h) || !name) {
        start = end + 1;
        continue;
      }
      const startLine = pendingFnLines.get(name) ?? 0;
      const key = startLine > 0 ? `${name}@${startLine}` : name;
      const fnLoc = loc(startLine);
      if (fileCov.fnMap[key] === undefined) {
        fileCov.fnMap[key] = { name, decl: fnLoc, loc: fnLoc };
        fileCov.f[key] = h;
      } else {
        fileCov.f[key] = (fileCov.f[key] as number) + h;
      }
    } else if (text.startsWith("BRDA:", start)) {
      const comma1 = text.indexOf(",", start + 5);
      const comma2 = comma1 !== -1 && comma1 < lineEnd ? text.indexOf(",", comma1 + 1) : -1;
      const comma3 = comma2 !== -1 && comma2 < lineEnd ? text.indexOf(",", comma2 + 1) : -1;

      const lineNoStr =
        comma1 !== -1 && comma1 < lineEnd
          ? text.slice(start + 5, comma1)
          : text.slice(start + 5, lineEnd);
      const blockId =
        comma1 !== -1 && comma1 < lineEnd
          ? comma2 !== -1 && comma2 < lineEnd
            ? text.slice(comma1 + 1, comma2)
            : text.slice(comma1 + 1, lineEnd)
          : "";
      const branchId =
        comma2 !== -1 && comma2 < lineEnd
          ? comma3 !== -1 && comma3 < lineEnd
            ? text.slice(comma2 + 1, comma3)
            : text.slice(comma2 + 1, lineEnd)
          : "";
      const takenStr = comma3 !== -1 && comma3 < lineEnd ? text.slice(comma3 + 1, lineEnd) : "";

      const lineNo = Number.parseInt(lineNoStr, 10);
      const taken = takenStr === "-" ? 0 : Number.parseInt(takenStr, 10);

      if (!Number.isInteger(lineNo) || !blockId || !branchId || !Number.isInteger(taken)) {
        start = end + 1;
        continue;
      }
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
    start = end + 1;
  }
  flush();

  // Convert per-file branch accumulator to Istanbul branchMap/b arrays.
  // All records for a file are fully merged before sorting, so branchId
  // sets that differ across records are handled correctly.
  for (const [fp, blocks] of fileBranches) {
    const fileCov = coverage[fp]!; // fp was validated against coverage when added to fileBranches
    for (const [blockKey, branches] of blocks) {
      const dashIdx = blockKey.indexOf("-");
      const lineNo = Number.parseInt(dashIdx === -1 ? blockKey : blockKey.slice(0, dashIdx), 10);
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

import { transformSync, type Loader } from "esbuild";
import { eachMapping, originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import { parse, type AnyNode } from "acorn";

function loaderFor(path: string): Loader | null {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".jsx")) return "jsx";
  if (/\.(?:ts|mts|cts)$/.test(path)) return "ts";
  if (/\.(?:js|mjs|cjs)$/.test(path)) return "js";
  return null;
}

/** Returns source lines that emit JavaScript, excluding import/export continuation lines. */
export function analyzeExecutableLines(source: string, path: string) {
  const language = loaderFor(path);
  if (language === null)
    return {
      lines: new Set<number>(),
      declarations: new Set<number>(),
      bodyLines: new Map<number, Set<number>>(),
    };
  const result = transformSync(source, {
    format: "esm",
    legalComments: "none",
    loader: language,
    sourcefile: path.replaceAll("\\", "/"),
    sourcemap: "external",
  });
  const lines = new Set<number>();
  eachMapping(new TraceMap(result.map), (mapping) => {
    lines.add(Number(mapping.originalLine));
  });
  lines.delete(0);
  let declarationStart = 0;
  for (const [index, text] of source.split("\n").entries()) {
    const trimmed = text.trimStart();
    if (
      declarationStart === 0 &&
      (/^import(?!\s*\()/.test(trimmed) || /^export\s*(?:type\s*)?(?:\{|\*)/.test(trimmed))
    )
      declarationStart = index + 1;
    if (declarationStart !== 0 && index + 1 > declarationStart) lines.delete(index + 1);
    if (declarationStart !== 0 && /(?:;|\sfrom\s+["'][^"']+["']\s*;?)\s*$/.test(trimmed))
      declarationStart = 0;
  }
  const { declarations, bodyLines } = arrowDeclarationLines(result.code, result.map);
  for (const line of declarations) lines.delete(line);
  return { lines, declarations, bodyLines };
}

/** Emitted executable lines, excluding source-only declarations and import continuations. */
export function executableLineNumbers(source: string, path: string): Set<number> {
  return analyzeExecutableLines(source, path).lines;
}

function arrowDeclarationLines(code: string, sourceMap: string) {
  const map = new TraceMap(sourceMap);
  const offsets = [0];
  for (let index = 0; index < code.length; index++) {
    if (code[index] === "\n") offsets.push(index + 1);
  }
  const mappings: { offset: number; line: number }[] = [];
  eachMapping(map, (mapping) => {
    mappings.push({
      offset: offsets[mapping.generatedLine - 1]! + mapping.generatedColumn,
      line: Number(mapping.originalLine),
    });
  });
  const headers: { start: number; end: number; bodyEnd: number }[] = [];
  const bodyLines = new Map<number, Set<number>>();
  const operationsByOffset = new Map<number, number | null>();
  const executable = new Set<number>();
  const preserve = (node: AnyNode) => {
    // Acorn populates every node location because this parse uses locations: true.
    const { line } = originalPositionFor(map, node.loc!.start);
    operationsByOffset.set(node.start, line);
    if (line !== null) executable.add(line);
  };
  const operations = new Set([
    "ExpressionStatement",
    "ReturnStatement",
    "ThrowStatement",
    "IfStatement",
    "SwitchStatement",
    "ForStatement",
    "ForInStatement",
    "ForOfStatement",
    "WhileStatement",
    "DoWhileStatement",
    "CallExpression",
    "NewExpression",
    "AwaitExpression",
    "YieldExpression",
    "UpdateExpression",
    "AssignmentExpression",
    "AssignmentPattern",
    "TaggedTemplateExpression",
    "ImportExpression",
    "BinaryExpression",
    "LogicalExpression",
    "ConditionalExpression",
    "MemberExpression",
    "SequenceExpression",
    "UnaryExpression",
    "TemplateLiteral",
    "SpreadElement",
  ]);
  function visit(node: AnyNode) {
    if (node.type === "ArrowFunctionExpression") {
      const body = node.body;
      headers.push({ start: node.start, end: body.start, bodyEnd: body.end });
      if (body.type !== "BlockStatement") preserve(body);
    }
    if (operations.has(node.type)) preserve(node);
    if (node.type === "Property") {
      if (node.computed) preserve(node.key);
      if (node.value.type !== "ArrowFunctionExpression") preserve(node.value);
    }
    if (
      node.type === "VariableDeclarator" &&
      node.init &&
      node.init.type !== "ArrowFunctionExpression" &&
      node.init.type !== "FunctionExpression"
    )
      preserve(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) if (child && typeof child.type === "string") visit(child);
      } else if (
        value &&
        typeof value === "object" &&
        "type" in value &&
        typeof value.type === "string"
      ) {
        visit(value as AnyNode);
      }
    }
  }
  visit(parse(code, { ecmaVersion: "latest", sourceType: "module", locations: true }));
  const declarations = new Set<number>();
  for (const header of headers) {
    const body = [...operationsByOffset].filter(
      ([offset]) => offset >= header.end && offset < header.bodyEnd,
    );
    // A counter cannot be removed unless every executable operation has source provenance.
    if (body.some(([, line]) => line === null)) continue;
    for (const mapping of mappings) {
      if (
        executable.has(mapping.line) ||
        mapping.offset < header.start ||
        mapping.offset >= header.end
      )
        continue;
      declarations.add(mapping.line);
      const lines = bodyLines.get(mapping.line) ?? new Set<number>();
      for (const [, line] of body) lines.add(line!);
      bodyLines.set(mapping.line, lines);
    }
  }
  // Unmapped segments normalize to zero, which is never a source line.
  declarations.delete(0);
  bodyLines.delete(0);
  return { declarations, bodyLines };
}

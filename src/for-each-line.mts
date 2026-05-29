/**
 * Iterates over `text` one line at a time without `split('\n')`.
 * Keeps behavior consistent with current parser logic by trimming only line ending
 * whitespace (`\r`, spaces, tabs) after extraction.
 */
export function forEachTrimmedLine(
  text: string,
  visit: (line: string, lineStart: number, lineEnd: number) => void,
): void {
  let lineStart = 0;
  while (lineStart < text.length) {
    let nl = text.indexOf("\n", lineStart);
    if (nl === -1) nl = text.length;
    const lineEnd = trimLineEnd(text, lineStart, nl);
    const line = text.slice(lineStart, lineEnd);
    visit(line, lineStart, lineEnd);
    lineStart = nl + 1;
  }
}

export function trimLineEnd(text: string, start: number, end: number): number {
  while (end > start) {
    const charCode = text.charCodeAt(end - 1);
    if (charCode === 32 || charCode === 9 || charCode === 13) {
      end--;
      continue;
    }
    break;
  }
  return end;
}

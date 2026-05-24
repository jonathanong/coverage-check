export type LineTrimmer = (line: string) => string;

const trimAsciiWhitespace = (line: string): string => {
  let end = line.length;
  while (end > 0) {
    const charCode = line.charCodeAt(end - 1);
    if (charCode === 32 || charCode === 9 || charCode === 13) {
      end--;
      continue;
    }
    break;
  }
  return line.slice(0, end);
};

export function forEachTextLine(
  text: string,
  onLine: (line: string) => void,
  trimLine: LineTrimmer = trimAsciiWhitespace,
): void {
  let start = 0;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    onLine(trimLine(text.slice(start, end)));
    start = end + 1;
  }
}

export function forEachBufferLine(
  buffer: Buffer,
  onLine: (line: string) => void,
  trimLine: LineTrimmer = (line) => line,
): void {
  let start = 0;
  while (start < buffer.length) {
    let end = buffer.indexOf(10, start);
    if (end === -1) end = buffer.length;
    onLine(trimLine(buffer.toString("utf8", start, end)));
    start = end + 1;
  }
}

export const trimLineEnd = trimAsciiWhitespace;

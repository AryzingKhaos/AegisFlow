export function createCliPrintChunk(line: string): string {
  return line.endsWith("\n") ? line : `${line}\n`;
}

export function writeCliLine(
  writer: {
    write: (chunk: string) => unknown;
  },
  line: string,
): void {
  writer.write(createCliPrintChunk(line));
}

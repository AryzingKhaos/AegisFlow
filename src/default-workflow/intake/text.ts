export function normalizeCliText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

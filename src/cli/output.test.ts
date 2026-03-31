import { describe, expect, it } from "vitest";
import { createCliPrintChunk, writeCliLine } from "./output";

describe("cli output writer", () => {
  it("preserves passthrough text that already ends with a newline", () => {
    expect(createCliPrintChunk("line with newline\n")).toBe(
      "line with newline\n",
    );
  });

  it("adds a single trailing newline for non-passthrough lines", () => {
    expect(createCliPrintChunk("line without newline")).toBe(
      "line without newline\n",
    );
  });

  it("writes the computed print chunk to the target writer", () => {
    const chunks: string[] = [];

    writeCliLine(
      {
        write(chunk: string) {
          chunks.push(chunk);
        },
      },
      "body\n",
    );

    expect(chunks).toEqual(["body\n"]);
  });
});

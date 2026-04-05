import type { CliViewModel, UiBlock } from "./ui-model";

export type OutputRegionLayout =
  | {
      kind: "result";
      blocks: UiBlock[];
    }
  | {
      kind: "skeleton";
      blocks: UiBlock[];
    }
  | {
      kind: "intermediate";
      lines: string[];
      hasOmittedLines: boolean;
    };

export function buildOutputRegionLayout(
  viewModel: CliViewModel,
  maxVisibleIntermediateLines: number,
): OutputRegionLayout[] {
  const flattenedIntermediateLines = flattenIntermediateLines(
    viewModel.intermediateLines,
  );
  const visibleIntermediateLines = flattenedIntermediateLines.slice(
    0,
    maxVisibleIntermediateLines,
  );

  return [
    ...(viewModel.finalBlocks.length > 0
      ? [
          {
            kind: "result" as const,
            blocks: viewModel.finalBlocks,
          },
        ]
      : []),
    ...(viewModel.skeletonBlocks.length > 0
      ? [
          {
            kind: "skeleton" as const,
            blocks: viewModel.skeletonBlocks,
          },
        ]
      : []),
    ...(visibleIntermediateLines.length > 0
      ? [
          {
            kind: "intermediate" as const,
            lines: visibleIntermediateLines,
            hasOmittedLines:
              flattenedIntermediateLines.length > maxVisibleIntermediateLines,
          },
        ]
      : []),
  ];
}

export function normalizeDisplayNewlines(value: string): string {
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

function flattenIntermediateLines(lines: string[]): string[] {
  return lines.flatMap((line) => normalizeDisplayNewlines(line).split("\n"));
}

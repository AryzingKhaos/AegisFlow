import type { CliViewModel, UiBlock } from "./ui-model";

export interface MainOutputEntry {
  block: UiBlock;
  source: "final" | "skeleton";
}

export type OutputRegionLayout =
  | {
      kind: "main_stream";
      entries: MainOutputEntry[];
    }
  | {
      kind: "process";
      summary: string;
      detailLines: string[];
      hasOmittedLines: boolean;
    };

export function buildOutputRegionLayout(
  viewModel: CliViewModel,
  maxVisibleIntermediateLines: number,
): OutputRegionLayout[] {
  const mainOutputEntries = buildMainOutputEntries(viewModel);
  const flattenedIntermediateLines = flattenIntermediateLines(
    viewModel.intermediateLines,
  );
  const processDetailLines = flattenedIntermediateLines.slice(
    Math.max(0, flattenedIntermediateLines.length - maxVisibleIntermediateLines),
  );
  const processSummary = buildProcessSummary(
    viewModel,
    flattenedIntermediateLines.at(-1),
  );

  return [
    ...(mainOutputEntries.length > 0
      ? [
          {
            kind: "main_stream" as const,
            entries: mainOutputEntries,
          },
        ]
      : []),
    ...(viewModel.taskStatus === "running" && processSummary
      ? [
          {
            kind: "process" as const,
            summary: processSummary,
            detailLines: processDetailLines,
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

export function buildProcessSummary(
  viewModel: Pick<CliViewModel, "currentPhase" | "taskStatus">,
  latestProcessLine?: string,
): string {
  if (viewModel.taskStatus !== "running") {
    return "";
  }

  const phaseLabel =
    viewModel.currentPhase && viewModel.currentPhase !== "-"
      ? viewModel.currentPhase
      : "当前阶段";
  const normalizedLatestLine = compactProcessLine(latestProcessLine);

  if (normalizedLatestLine) {
    return `运行中 · ${phaseLabel} · ${normalizedLatestLine}`;
  }

  return `运行中 · ${phaseLabel} · 等待新的过程输出`;
}

function buildMainOutputEntries(viewModel: CliViewModel): MainOutputEntry[] {
  return [
    ...viewModel.finalBlocks.map((block) => ({
      block,
      source: "final" as const,
    })),
    ...viewModel.skeletonBlocks.map((block) => ({
      block,
      source: "skeleton" as const,
    })),
  ].sort((left, right) => left.block.order - right.block.order);
}

function flattenIntermediateLines(lines: string[]): string[] {
  return lines.flatMap((line) => normalizeDisplayNewlines(line).split("\n"));
}

function compactProcessLine(line?: string): string {
  if (!line) {
    return "";
  }

  const normalized = normalizeDisplayNewlines(line)
    .replace(/\s+/g, " ")
    .trim();

  if (normalized.length <= 72) {
    return normalized;
  }

  return `${normalized.slice(0, 69)}...`;
}

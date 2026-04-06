import { describe, expect, it } from "vitest";
import { buildOutputRegionLayout, buildProcessSummary } from "./output-layout";
import type { CliViewModel, UiBlock } from "./ui-model";

describe("cli output layout", () => {
  it("merges final and skeleton content into a single main stream ordered by block order", () => {
    const layout = buildOutputRegionLayout(
      createViewModel({
        finalBlocks: [createBlock("result-1", 4, "result")],
        skeletonBlocks: [
          createBlock("skeleton-1", 1, "system"),
          createBlock("skeleton-2", 7, "system"),
        ],
        intermediateLines: ["step-1", "step-2"],
      }),
      6,
    );

    expect(layout.map((region) => region.kind)).toEqual(["main_stream", "process"]);
    expect(
      layout[0]?.kind === "main_stream"
        ? layout[0].entries.map((entry) => `${entry.source}:${entry.block.id}`)
        : [],
    ).toEqual([
      "skeleton:skeleton-1",
      "final:result-1",
      "skeleton:skeleton-2",
    ]);
    expect(layout[1]).toMatchObject({
      kind: "process",
      detailLines: ["step-1", "step-2"],
      hasOmittedLines: false,
    });
  });

  it("renders only the main stream when the task is not running", () => {
    expect(
      buildOutputRegionLayout(
        createViewModel({
          taskStatus: "completed",
          skeletonBlocks: [createBlock("skeleton-1", 0, "system")],
        }),
        6,
      ).map((region) => region.kind),
    ).toEqual(["main_stream"]);

    expect(
      buildOutputRegionLayout(
        createViewModel({
          taskStatus: "completed",
          intermediateLines: ["progress"],
        }),
        6,
      ).map((region) => region.kind),
    ).toEqual([]);

    expect(buildOutputRegionLayout(createViewModel({ taskStatus: "completed" }), 6)).toEqual([]);
  });

  it("keeps process summary visible and truncates detail lines to the latest six lines", () => {
    const layout = buildOutputRegionLayout(
      createViewModel({
        currentPhase: "build",
        intermediateLines: [
          "line-1",
          "line-2",
          "line-3",
          "line-4",
          "line-5",
          "line-6",
          "line-7",
        ],
      }),
      6,
    );

    expect(layout).toHaveLength(1);
    expect(layout[0]).toMatchObject({
      kind: "process",
      summary: "运行中 · build · line-7",
      detailLines: ["line-2", "line-3", "line-4", "line-5", "line-6", "line-7"],
      hasOmittedLines: true,
    });
  });

  it("builds a fallback process summary when there is no detail line yet", () => {
    expect(
      buildProcessSummary(
        {
          currentPhase: "clarify",
          taskStatus: "running",
        },
        undefined,
      ),
    ).toBe("运行中 · clarify · 等待新的过程输出");
  });
});

function createViewModel(
  overrides: Partial<
    Pick<
      CliViewModel,
      "currentPhase" | "taskStatus" | "finalBlocks" | "skeletonBlocks" | "intermediateLines"
    >
  > = {},
): CliViewModel {
  return {
    appTitle: "AegisFlow Intake",
    sessionTitle: "demo",
    currentPhase: overrides.currentPhase ?? "clarify",
    taskStatus: overrides.taskStatus ?? "running",
    inputHint: "输入需求或任务控制指令",
    nextBlockOrder: 0,
    finalBlocks: overrides.finalBlocks ?? [],
    skeletonBlocks: overrides.skeletonBlocks ?? [],
    intermediateLines: overrides.intermediateLines ?? [],
  };
}

function createBlock(
  id: string,
  order: number,
  tone: UiBlock["tone"],
): UiBlock {
  return {
    id,
    order,
    title: id,
    body: `${id}-body`,
    tone,
  };
}

import { describe, expect, it } from "vitest";
import { buildOutputRegionLayout } from "./output-layout";
import type { CliViewModel, UiBlock } from "./ui-model";

describe("cli output layout", () => {
  it("keeps result, skeleton, and intermediate content in fixed region order", () => {
    const layout = buildOutputRegionLayout(
      createViewModel({
        finalBlocks: [createBlock("result-1", 4, "result")],
        skeletonBlocks: [
          createBlock("skeleton-1", 1, "system"),
          createBlock("skeleton-2", 7, "system"),
        ],
        intermediateLines: ["step-1", "step-2"],
      }),
      5,
    );

    expect(layout.map((region) => region.kind)).toEqual([
      "result",
      "skeleton",
      "intermediate",
    ]);
    expect(layout[0]?.kind).toBe("result");
    expect(layout[0]?.kind === "result" ? layout[0].blocks.map((block) => block.id) : []).toEqual([
      "result-1",
    ]);
    expect(
      layout[1]?.kind === "skeleton"
        ? layout[1].blocks.map((block) => block.id)
        : [],
    ).toEqual(["skeleton-1", "skeleton-2"]);
    expect(
      layout[2]?.kind === "intermediate" ? layout[2].lines : [],
    ).toEqual(["step-1", "step-2"]);
  });

  it("renders only regions that actually have content", () => {
    expect(
      buildOutputRegionLayout(
        createViewModel({
          skeletonBlocks: [createBlock("skeleton-1", 0, "system")],
        }),
        3,
      ).map((region) => region.kind),
    ).toEqual(["skeleton"]);

    expect(
      buildOutputRegionLayout(
        createViewModel({
          intermediateLines: ["progress"],
        }),
        3,
      ).map((region) => region.kind),
    ).toEqual(["intermediate"]);

    expect(buildOutputRegionLayout(createViewModel(), 3)).toEqual([]);
  });

  it("truncates intermediate lines inside the intermediate region only", () => {
    const layout = buildOutputRegionLayout(
      createViewModel({
        intermediateLines: ["line-1\\nline-2", "line-3"],
      }),
      2,
    );

    expect(layout).toHaveLength(1);
    expect(layout[0]).toMatchObject({
      kind: "intermediate",
      lines: ["line-1", "line-2"],
      hasOmittedLines: true,
    });
  });
});

function createViewModel(
  overrides: Partial<
    Pick<CliViewModel, "finalBlocks" | "skeletonBlocks" | "intermediateLines">
  > = {},
): CliViewModel {
  return {
    appTitle: "AegisFlow Intake",
    sessionTitle: "demo",
    currentPhase: "clarify",
    taskStatus: "running",
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

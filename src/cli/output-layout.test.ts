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

  it("promotes codex exec interruption into a failure main screen ahead of historical output", () => {
    const layout = buildOutputRegionLayout(
      createViewModel({
        taskStatus: "failed",
        currentError: {
          summary: "阶段执行失败。",
          reason: "Role agent execution failed: executor transport error: socket hang up",
          location: "阶段：build | 角色：builder",
          nextAction: "检查网络连通性、provider/transport 配置与认证环境；修正后可恢复或重新发起任务。",
          source: "workflow",
        },
        skeletonBlocks: [createBlock("task-end", 9, "system")],
      }),
      6,
    );

    expect(layout.map((region) => region.kind)).toEqual([
      "failure_main_screen",
      "main_stream",
    ]);
    expect(layout[0]).toMatchObject({
      kind: "failure_main_screen",
      error: {
        summary: "阶段执行失败。",
      },
    });
    expect(layout[1]).toMatchObject({
      kind: "main_stream",
      title: "历史输出",
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

  it("does not enter failure main screen mode for non-executor failures", () => {
    const layout = buildOutputRegionLayout(
      createViewModel({
        taskStatus: "failed",
        currentError: {
          summary: "阶段执行失败。",
          reason: "artifactReady=false: builder 未产出可落盘工件。",
          location: "阶段：build | 角色：builder",
          nextAction: "检查当前阶段是否按要求产出了可落盘工件，然后重新执行或恢复任务。",
          source: "workflow",
        },
        skeletonBlocks: [createBlock("task-end", 9, "system")],
      }),
      6,
    );

    expect(layout.map((region) => region.kind)).toEqual(["main_stream"]);
  });

  it("does not enter failure main screen mode for generic provider wording without executor context", () => {
    const layout = buildOutputRegionLayout(
      createViewModel({
        taskStatus: "failed",
        currentError: {
          summary: "阶段执行失败。",
          reason: "provider 配置缺失：请检查 .aegisflow/aegisproject.yaml。",
          location: "配置文件：/tmp/demo/.aegisflow/aegisproject.yaml",
          nextAction: "修正 .aegisflow/aegisproject.yaml 中的配置后重新发起任务。",
          source: "workflow",
        },
        skeletonBlocks: [createBlock("task-end", 9, "system")],
      }),
      6,
    );

    expect(layout.map((region) => region.kind)).toEqual(["main_stream"]);
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
      | "currentPhase"
      | "taskStatus"
      | "currentError"
      | "finalBlocks"
      | "skeletonBlocks"
      | "intermediateLines"
    >
  > = {},
): CliViewModel {
  return {
    appTitle: "AegisFlow Intake",
    sessionTitle: "demo",
    currentPhase: overrides.currentPhase ?? "clarify",
    taskStatus: overrides.taskStatus ?? "running",
    inputHint: "输入需求或任务控制指令",
    currentError: overrides.currentError,
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

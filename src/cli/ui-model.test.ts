import { describe, expect, it } from "vitest";
import {
  appendIntakeError,
  appendSystemLines,
  applyWorkflowEventToCliViewModel,
  clearCliError,
  createInitialCliViewModel,
} from "./ui-model";
import { TaskStatus, type WorkflowEvent } from "../default-workflow/shared/types";

describe("cli ui model", () => {
  it("routes progress role_output into bounded intermediate lines", () => {
    let viewModel = createInitialCliViewModel(["boot"]);

    viewModel = applyWorkflowEventToCliViewModel(
      viewModel,
      createWorkflowEvent("role_output", "step-1", {
        outputKind: "progress",
        phase: "build",
        roleName: "builder",
      }),
      {
        maxIntermediateLines: 2,
      },
    );
    viewModel = applyWorkflowEventToCliViewModel(
      viewModel,
      createWorkflowEvent("role_output", "step-2", {
        outputKind: "progress",
        phase: "build",
        roleName: "builder",
      }),
      {
        maxIntermediateLines: 2,
      },
    );
    viewModel = applyWorkflowEventToCliViewModel(
      viewModel,
      createWorkflowEvent("role_output", "step-3", {
        outputKind: "progress",
        phase: "build",
        roleName: "builder",
      }),
      {
        maxIntermediateLines: 2,
      },
    );

    expect(viewModel.intermediateLines).toEqual(["step-2", "step-3"]);
    expect(viewModel.finalBlocks).toHaveLength(1);
  });

  it("routes summary role_output into final result blocks", () => {
    const viewModel = applyWorkflowEventToCliViewModel(
      createInitialCliViewModel([]),
      createWorkflowEvent("role_output", "最终方案已确认", {
        outputKind: "summary",
        phase: "plan",
        roleName: "planner",
      }),
    );

    expect(viewModel.finalBlocks.at(-1)?.title).toBe("planner @ plan · summary");
    expect(viewModel.finalBlocks.at(-1)?.body).toBe("最终方案已确认");
    expect(viewModel.intermediateLines).toEqual([]);
  });

  it("keeps skeleton events separate from final and intermediate content", () => {
    const viewModel = applyWorkflowEventToCliViewModel(
      createInitialCliViewModel([]),
      createWorkflowEvent("phase_start", "阶段 explore 开始执行。", {
        phase: "explore",
        roleName: "explorer",
      }),
      {
        maxSkeletonBlocks: 4,
      },
    );

    expect(viewModel.skeletonBlocks).toHaveLength(1);
    expect(viewModel.skeletonBlocks[0]?.title).toBe("阶段开始");
    expect(viewModel.finalBlocks).toEqual([]);
    expect(viewModel.intermediateLines).toEqual([]);
  });

  it("appends system lines as muted final blocks", () => {
    const viewModel = appendSystemLines(
      createInitialCliViewModel([]),
      ["行一", "行二"],
      "系统消息",
    );

    expect(viewModel.finalBlocks).toHaveLength(1);
    expect(viewModel.finalBlocks[0]?.title).toBe("系统消息");
    expect(viewModel.finalBlocks[0]?.body).toBe("行一\n行二");
    expect(viewModel.finalBlocks[0]?.tone).toBe("muted");
  });

  it("preserves cross-stream order between skeleton and final blocks", () => {
    let viewModel = createInitialCliViewModel([]);

    viewModel = applyWorkflowEventToCliViewModel(
      viewModel,
      createWorkflowEvent("phase_start", "clarify 开始", {
        phase: "clarify",
      }),
    );
    viewModel = applyWorkflowEventToCliViewModel(
      viewModel,
      createWorkflowEvent("role_output", "最终方案已确认", {
        outputKind: "summary",
        phase: "clarify",
        roleName: "clarifier",
      }),
    );
    viewModel = applyWorkflowEventToCliViewModel(
      viewModel,
      createWorkflowEvent("phase_end", "clarify 结束", {
        phase: "clarify",
      }),
    );

    expect(viewModel.skeletonBlocks[0]?.order).toBeLessThan(
      viewModel.finalBlocks[0]?.order ?? Number.POSITIVE_INFINITY,
    );
    expect(viewModel.finalBlocks[0]?.order).toBeLessThan(
      viewModel.skeletonBlocks[1]?.order ?? Number.POSITIVE_INFINITY,
    );
  });

  it("maps runtime error events into a structured current error view", () => {
    const viewModel = applyWorkflowEventToCliViewModel(
      createInitialCliViewModel([]),
      createWorkflowEvent("error", "阶段执行失败。", {
        phase: "build",
        roleName: "builder",
        error: "artifactReady=false: builder 未产出可落盘工件。",
      }),
    );

    expect(viewModel.currentError).toEqual({
      summary: "阶段执行失败。",
      reason: "artifactReady=false: builder 未产出可落盘工件。",
      location: "阶段：build | 角色：builder",
      nextAction: "检查当前阶段是否按要求产出了可落盘工件，然后重新执行或恢复任务。",
      source: "workflow",
    });
    expect(viewModel.finalBlocks).toEqual([]);
    expect(viewModel.skeletonBlocks.at(-1)?.title).toBe("错误事件");
  });

  it("appends and clears intake errors explicitly", () => {
    const erroredViewModel = appendIntakeError(createInitialCliViewModel([]), {
      summary: "读取项目 workflow 配置失败。",
      reason: "项目 workflow 配置非法：workflows 不能为空。",
      location: "配置文件：/tmp/demo/.aegisflow/aegisproject.yaml",
      nextAction: "修正 .aegisflow/aegisproject.yaml 中的配置后重新发起任务。",
      source: "intake",
    });

    expect(erroredViewModel.currentError?.reason).toBe(
      "项目 workflow 配置非法：workflows 不能为空。",
    );
    expect(clearCliError(erroredViewModel).currentError).toBeUndefined();
  });
});

function createWorkflowEvent(
  type: WorkflowEvent["type"],
  message: string,
  metadata: Record<string, unknown> = {},
): WorkflowEvent {
  return {
    type,
    taskId: "task_demo",
    message,
    timestamp: Date.now(),
    taskState: {
      taskId: "task_demo",
      title: "demo",
      currentPhase:
        typeof metadata.phase === "string" ? metadata.phase : "clarify",
      phaseStatus: "running",
      status: TaskStatus.RUNNING,
      updatedAt: Date.now(),
    },
    metadata,
  };
}

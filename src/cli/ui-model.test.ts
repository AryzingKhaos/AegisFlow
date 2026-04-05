import { describe, expect, it } from "vitest";
import {
  appendSystemLines,
  applyWorkflowEventToCliViewModel,
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
    expect(viewModel.finalBlocks[0]?.tone).toBe("system");
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

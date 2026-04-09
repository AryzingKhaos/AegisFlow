import { describe, expect, it } from "vitest";
import {
  createIntakeErrorViewFromWorkflowEvent,
  isCodexExecInterruption,
} from "./error-view";
import { TaskStatus, type WorkflowEvent } from "../shared/types";

describe("intake error view", () => {
  it("recognizes codex transport interruptions as failure-main-screen candidates", () => {
    const error = createIntakeErrorViewFromWorkflowEvent(
      createWorkflowErrorEvent(
        "阶段执行失败。",
        "Role agent execution failed: executor transport error: socket hang up",
      ),
    );

    expect(isCodexExecInterruption(error, "failed")).toBe(true);
    expect(error.nextAction).toBe(
      "检查网络连通性、provider/transport 配置与认证环境；修正后可恢复或重新发起任务。",
    );
  });

  it("maps timeout failures to timeout-specific next actions", () => {
    const error = createIntakeErrorViewFromWorkflowEvent(
      createWorkflowErrorEvent(
        "阶段执行失败。",
        "Role agent execution failed: command timed out after 300000ms",
      ),
    );

    expect(isCodexExecInterruption(error, "failed")).toBe(true);
    expect(error.nextAction).toBe(
      "检查网络、执行环境与超时配置；必要时适当提高超时时间后恢复或重新发起任务。",
    );
  });

  it("maps quota and token failures to quota-specific next actions", () => {
    const error = createIntakeErrorViewFromWorkflowEvent(
      createWorkflowErrorEvent(
        "阶段执行失败。",
        "Role agent execution failed: insufficient_quota: token 配额已耗尽",
      ),
    );

    expect(isCodexExecInterruption(error, "failed")).toBe(true);
    expect(error.nextAction).toBe(
      "检查模型额度、token 配额或账单状态；恢复可用额度后再恢复或重新发起任务。",
    );
  });

  it("does not misclassify ordinary workflow artifact failures as codex interruptions", () => {
    const error = createIntakeErrorViewFromWorkflowEvent(
      createWorkflowErrorEvent(
        "阶段执行失败。",
        "artifactReady=false: builder 未产出可落盘工件。",
      ),
    );

    expect(isCodexExecInterruption(error, "failed")).toBe(false);
  });

  it("does not misclassify generic provider wording without executor chain context", () => {
    expect(
      isCodexExecInterruption(
        {
          summary: "阶段执行失败。",
          reason: "provider 配置缺失：请检查 .aegisflow/aegisproject.yaml。",
          location: "配置文件：/tmp/demo/.aegisflow/aegisproject.yaml",
          nextAction: "修正 .aegisflow/aegisproject.yaml 中的配置后重新发起任务。",
          source: "workflow",
        },
        "failed",
      ),
    ).toBe(false);
  });

  it("does not misclassify generic token or authentication wording without executor chain context", () => {
    expect(
      isCodexExecInterruption(
        {
          summary: "阶段执行失败。",
          reason: "token 校验规则不满足，authentication 配置需要更新。",
          location: "阶段：build | 角色：builder",
          nextAction: "根据失败原因修正问题后重试；必要时可恢复任务或重新输入需求。",
          source: "workflow",
        },
        "failed",
      ),
    ).toBe(false);
  });

  it("does not misclassify generic timeout wording without executor chain context", () => {
    expect(
      isCodexExecInterruption(
        {
          summary: "阶段执行失败。",
          reason: "审批等待超时，请稍后重新提交。",
          location: "阶段：review | 角色：critic",
          nextAction: "根据失败阶段和角色检查输入、工件与配置；修正后可重新发起或恢复任务。",
          source: "workflow",
        },
        "failed",
      ),
    ).toBe(false);
  });
});

function createWorkflowErrorEvent(
  message: string,
  reason: string,
): WorkflowEvent {
  return {
    type: "error",
    taskId: "task_demo",
    message,
    timestamp: Date.now(),
    taskState: {
      taskId: "task_demo",
      title: "demo",
      currentPhase: "build",
      phaseStatus: "failed",
      status: TaskStatus.FAILED,
      updatedAt: Date.now(),
    },
    metadata: {
      error: reason,
      phase: "build",
      roleName: "builder",
      status: TaskStatus.FAILED,
    },
  };
}

import { formatTaskStateSummary } from "../shared/utils";
import type { WorkflowEvent } from "../shared/types";

export function formatWorkflowEventForCli(event: WorkflowEvent): string[] {
  const lines: string[] = [];
  const title = buildEventTitle(event);
  const normalizedMessage = normalizeCliText(event.message);
  const taskStateLine = `TaskState 摘要：${formatTaskStateSummary(event.taskState)}`;

  if (title) {
    lines.push(title);
  }

  if (normalizedMessage) {
    lines.push(normalizedMessage);
  }

  const metadataLines = buildMetadataLines(event);

  if (metadataLines.length > 0) {
    lines.push(...metadataLines);
  }

  lines.push(taskStateLine);

  return [lines.join("\n")];
}

export function normalizeCliText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildEventTitle(event: WorkflowEvent): string {
  switch (event.type) {
    case "task_start":
      return "=== 任务开始 ===";
    case "task_end":
      return "=== 任务结束 ===";
    case "phase_start":
      return `=== 阶段开始｜${String(event.metadata?.phase ?? "")} ===`;
    case "phase_end":
      return `=== 阶段结束｜${String(event.metadata?.phase ?? "")} ===`;
    case "role_start":
      return `--- 角色开始｜${String(event.metadata?.roleName ?? "")} @ ${String(event.metadata?.phase ?? "")} ---`;
    case "role_end":
      return `--- 角色结束｜${String(event.metadata?.roleName ?? "")} @ ${String(event.metadata?.phase ?? "")} ---`;
    case "role_output":
      return `>>> 角色输出｜${String(event.metadata?.roleName ?? "")} @ ${String(event.metadata?.phase ?? "")}`;
    case "artifact_created":
      return `+++ 工件已创建｜${String(event.metadata?.roleName ?? "")} @ ${String(event.metadata?.phase ?? "")}`;
    case "progress":
      return "*** 进度更新 ***";
    case "error":
      return "!!! 执行错误 !!!";
    default:
      return `[WorkflowEvent:${event.type}]`;
  }
}

function buildMetadataLines(event: WorkflowEvent): string[] {
  switch (event.type) {
    case "role_end": {
      if (shouldSkipRoleEndSummary(event)) {
        return [];
      }

      const summary = normalizeMetadataText(event.metadata?.summary);
      return summary ? [`结果摘要：\n${summary}`] : [];
    }
    case "role_output": {
      const outputKind = event.metadata?.outputKind;
      return outputKind ? [`输出类型：${String(outputKind)}`] : [];
    }
    case "artifact_created": {
      const artifactPath = event.metadata?.artifactPath;
      return artifactPath ? [`工件路径：${String(artifactPath)}`] : [];
    }
    case "error": {
      const errorMessage = normalizeMetadataText(event.metadata?.error);
      return errorMessage ? [`错误详情：\n${errorMessage}`] : [];
    }
    default:
      return [];
  }
}

function normalizeMetadataText(value: unknown): string {
  return typeof value === "string" ? normalizeCliText(value) : "";
}

function shouldSkipRoleEndSummary(event: WorkflowEvent): boolean {
  const roleMetadata = event.metadata?.metadata;

  return Boolean(
    roleMetadata &&
      typeof roleMetadata === "object" &&
      "visibleSummaryDelivered" in roleMetadata &&
      (roleMetadata as Record<string, unknown>).visibleSummaryDelivered === true,
  );
}

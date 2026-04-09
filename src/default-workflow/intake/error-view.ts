import type { WorkflowEvent } from "../shared/types";
import { normalizeCliText } from "./text";

export interface IntakeErrorView {
  summary: string;
  reason: string;
  location?: string;
  nextAction?: string;
  source: "workflow" | "intake" | "cli";
}

export function createIntakeErrorViewFromWorkflowEvent(
  event: WorkflowEvent,
): IntakeErrorView {
  const summary = normalizeCliText(event.message) || "任务执行失败。";
  const reason =
    typeof event.metadata?.error === "string" && normalizeCliText(event.metadata.error)
      ? normalizeCliText(event.metadata.error)
      : summary;
  const location = buildErrorLocation({
    phase:
      typeof event.metadata?.phase === "string"
        ? event.metadata.phase
        : event.taskState.currentPhase,
    roleName:
      typeof event.metadata?.roleName === "string"
        ? event.metadata.roleName
        : undefined,
    configPath: extractConfigPath([summary, reason]),
  });

  return {
    summary,
    reason,
    location,
    nextAction: inferNextAction(reason, location, "workflow"),
    source: "workflow",
  };
}

export function createIntakeErrorViewFromUnknown(
  error: unknown,
  input: {
    summary: string;
    location?: string;
    nextAction?: string;
    source?: IntakeErrorView["source"];
  },
): IntakeErrorView {
  const summary = normalizeCliText(input.summary) || "执行失败。";
  const reason = normalizeCliText(resolveUnknownErrorMessage(error)) || summary;
  const inferredConfigPath = extractConfigPath([summary, reason]);
  const inferredLocation =
    input.location ?? buildErrorLocation({ configPath: inferredConfigPath });

  return {
    summary,
    reason,
    location: inferredLocation,
    nextAction:
      input.nextAction ??
      inferNextAction(reason, inferredLocation, input.source ?? "intake"),
    source: input.source ?? "intake",
  };
}

export function formatIntakeErrorForCli(error: IntakeErrorView): string[] {
  const lines = ["!!! 执行错误 !!!", `失败摘要：${error.summary}`, `失败原因：\n${error.reason}`];

  if (error.location) {
    lines.push(`失败位置：${error.location}`);
  }

  if (error.nextAction) {
    lines.push(`下一步建议：\n${error.nextAction}`);
  }

  return [lines.join("\n")];
}

export function isCodexExecInterruption(
  error: IntakeErrorView | undefined,
  taskStatus?: string,
): boolean {
  if (!error || taskStatus !== "failed" || error.source !== "workflow") {
    return false;
  }

  const normalized = `${error.summary}\n${error.reason}\n${error.location ?? ""}`.toLowerCase();

  return hasCodexExecChainContext(normalized);
}

function resolveUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error ?? "发生未知错误，请检查配置后重试。");
}

function buildErrorLocation(input: {
  phase?: string;
  roleName?: string;
  configPath?: string;
  pathValue?: string;
}): string | undefined {
  const parts: string[] = [];

  if (input.phase) {
    parts.push(`阶段：${input.phase}`);
  }

  if (input.roleName) {
    parts.push(`角色：${input.roleName}`);
  }

  if (input.configPath) {
    parts.push(`配置文件：${input.configPath}`);
  } else if (input.pathValue) {
    parts.push(`路径：${input.pathValue}`);
  }

  return parts.length > 0 ? parts.join(" | ") : undefined;
}

function inferNextAction(
  reason: string,
  location: string | undefined,
  source: IntakeErrorView["source"],
): string {
  const normalized = reason.toLowerCase();
  const hasCodexExecContext =
    source === "workflow" && hasCodexExecChainContext(normalized);

  if (
    hasCodexExecContext &&
    normalized.includes("executor timed out") ||
    hasCodexExecContext &&
    normalized.includes("timed out") ||
    hasCodexExecContext &&
    normalized.includes("timeout")
  ) {
    return "检查网络、执行环境与超时配置；必要时适当提高超时时间后恢复或重新发起任务。";
  }

  if (
    hasCodexExecContext &&
    normalized.includes("token") ||
    hasCodexExecContext &&
    normalized.includes("quota") ||
    hasCodexExecContext &&
    normalized.includes("额度") ||
    hasCodexExecContext &&
    normalized.includes("insufficient_quota") ||
    hasCodexExecContext &&
    normalized.includes("rate limit")
  ) {
    return "检查模型额度、token 配额或账单状态；恢复可用额度后再恢复或重新发起任务。";
  }

  if (
    hasCodexExecContext &&
    normalized.includes("transport") ||
    hasCodexExecContext &&
    normalized.includes("provider") ||
    hasCodexExecContext &&
    normalized.includes("authentication") ||
    hasCodexExecContext &&
    normalized.includes("api key") ||
    hasCodexExecContext &&
    normalized.includes("network") ||
    hasCodexExecContext &&
    normalized.includes("socket") ||
    hasCodexExecContext &&
    normalized.includes("econn") ||
    hasCodexExecContext &&
    normalized.includes("enotfound") ||
    hasCodexExecContext &&
    normalized.includes("eai_again")
  ) {
    return "检查网络连通性、provider/transport 配置与认证环境；修正后可恢复或重新发起任务。";
  }

  if (
    normalized.includes(".aegisflow/aegisproject.yaml") ||
    normalized.includes("workflow 配置非法") ||
    normalized.includes("workflow configuration")
  ) {
    return "修正 .aegisflow/aegisproject.yaml 中的配置后重新发起任务。";
  }

  if (
    normalized.includes("目录") ||
    normalized.includes("directory") ||
    normalized.includes("不可访问") ||
    normalized.includes("not accessible")
  ) {
    return "检查目录路径是否存在且当前进程有访问权限，然后重试。";
  }

  if (normalized.includes("artifactready=false")) {
    return "检查当前阶段是否按要求产出了可落盘工件，然后重新执行或恢复任务。";
  }

  if (location?.includes("阶段：") || location?.includes("角色：")) {
    return "根据失败阶段和角色检查输入、工件与配置；修正后可重新发起或恢复任务。";
  }

  if (source === "cli") {
    return "检查当前输入或执行环境后重试；必要时重新发起任务。";
  }

  return "根据失败原因修正问题后重试；必要时可恢复任务或重新输入需求。";
}

function extractConfigPath(values: string[]): string | undefined {
  for (const value of values) {
    const matched =
      value.match(/[^\s。]+\.aegisflow\/aegisproject\.yaml/u) ??
      value.match(/[^\s]+aegisproject\.yaml/u);

    if (!matched) {
      continue;
    }

    return matched[0].replace(/\\/g, "/");
  }

  return undefined;
}

function hasCodexExecChainContext(normalized: string): boolean {
  return (
    normalized.includes("role agent execution failed:") ||
    normalized.includes("role agent execution failed.") ||
    normalized.includes("executor transport error") ||
    normalized.includes("executor timed out") ||
    normalized.includes("codex exited with code")
  );
}

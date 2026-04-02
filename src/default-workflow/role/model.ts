import type {
  ArtifactReader,
  ExecutionContext,
  RoleCapabilityProfile,
  RoleName,
  RoleResult,
  RoleRuntime,
  RoleVisibleOutput,
} from "../shared/types";
import { resolveRoleCodexConfig } from "./config";
import {
  createRoleAgentExecutor,
  type RoleAgentExecutor,
} from "./executor";
import { buildRolePrompt } from "./prompts";

export interface RoleAgentBootstrap {
  executor: RoleAgentExecutor;
  prompt: string;
  promptSources: string[];
  promptWarnings: string[];
  config: ReturnType<typeof resolveRoleCodexConfig>;
}

interface VisibleArtifact {
  key: string;
  content: string;
}

export async function initializeRoleAgent(
  roleName: RoleName,
  roleRuntime: RoleRuntime,
): Promise<RoleAgentBootstrap> {
  // 角色初始化只依赖 RoleRuntime 暴露的受限配置，
  // 不允许在这里回头读取 WorkflowController 或 TaskState。
  const config = resolveRoleCodexConfig();
  const promptBundle = await buildRolePrompt(roleName, roleRuntime.projectConfig);

  return {
    // bootstrap 只负责装配“执行器 + prompt + 配置”，
    // 真正执行放到 run 阶段，避免角色实例化时就触发模型调用。
    executor: createRoleAgentExecutor(),
    prompt: promptBundle.prompt,
    promptSources: promptBundle.promptSources,
    promptWarnings: promptBundle.promptWarnings,
    config,
  };
}

export async function executeRoleAgent(input: {
  bootstrap: RoleAgentBootstrap;
  roleName: RoleName;
  executionProfile: RoleCapabilityProfile;
  context: ExecutionContext;
  input: string;
}): Promise<RoleResult> {
  const visibleArtifacts = await loadVisibleArtifacts(input.context.artifacts);
  await emitRoleVisibleOutput(input.context, {
    message: `角色 ${input.roleName} 已开始执行，当前阶段：${input.context.phase}。`,
    kind: "progress",
  });
  const executionPrompt = buildRoleExecutionPrompt(
    input.bootstrap.prompt,
    input.roleName,
    input.executionProfile,
    input.context,
    input.input,
    visibleArtifacts,
  );

  if (input.bootstrap.config.executionMode === "stub") {
    const stubResult = buildStubRoleResult(
      input.bootstrap,
      input.roleName,
      input.executionProfile,
      input.context,
      input.input,
      visibleArtifacts,
      executionPrompt,
    );

    await emitRoleVisibleOutput(input.context, {
      message: stubResult.summary,
      kind: "summary",
    });

    return stubResult;
  }

  // 默认执行模式必须真实进入统一角色执行器，
  // 不能退化成直接调用通用聊天模型接口。
  const rawContent = await input.bootstrap.executor.execute({
    roleName: input.roleName,
    prompt: executionPrompt,
    context: input.context,
    executionProfile: input.executionProfile,
    config: input.bootstrap.config,
  });
  const parsed = parseRoleResultPayload(rawContent);
  await emitRoleVisibleOutput(input.context, {
    message: parsed.summary,
    kind: "summary",
  });

  return {
    summary: parsed.summary,
    artifacts: parsed.artifacts,
    artifactReady: parsed.artifactReady,
    phaseCompleted: parsed.phaseCompleted,
    metadata: {
      ...parsed.metadata,
      // 这些元信息用于后续确认一次角色输出到底走的是哪条执行链路，
      // 防止“看起来是 agent，实际又退回普通模型调用”的回归。
      agentConfigured: true,
      visibleSummaryDelivered: true,
      executionMode: input.bootstrap.config.executionMode,
      agentExecutor: input.bootstrap.executor.executorKind,
      agentModel: input.bootstrap.config.model,
      promptSources: input.bootstrap.promptSources,
      promptWarnings: input.bootstrap.promptWarnings,
      executionProfile: input.executionProfile,
      visibleArtifactKeys: visibleArtifacts.map((artifact) => artifact.key),
    },
  };
}

async function emitRoleVisibleOutput(
  context: ExecutionContext,
  output: RoleVisibleOutput,
): Promise<void> {
  await context.emitVisibleOutput?.(output);
}

function buildRoleExecutionPrompt(
  basePrompt: string,
  roleName: RoleName,
  executionProfile: RoleCapabilityProfile,
  context: ExecutionContext,
  input: string,
  visibleArtifacts: VisibleArtifact[],
): string {
  // 这里把角色职责、执行上下文、工件可见范围统一压成一份执行协议，
  // 确保不同角色虽然复用同一执行器，但仍然按各自边界工作。
  return [
    basePrompt,
    "",
    "## 角色执行协议",
    "",
    "你现在要执行一次真实的角色任务，而不是解释规则或复述 prompt。",
    "你必须基于下方上下文产出结构化 JSON，不能输出额外说明文字。",
    "",
    "返回 JSON 格式：",
    "{",
    '  "summary": "字符串，概括本次角色执行结果",',
    '  "artifacts": ["每个元素都是可直接落盘为 md 的完整内容"],',
    '  "artifactReady": "可选布尔值，表示当前 artifacts 是否允许 Workflow 落盘",',
    '  "phaseCompleted": "可选布尔值，表示当前 phase 是否可以结束",',
    '  "metadata": { "可选附加元信息": "任意 JSON 值" }',
    "}",
    "",
    "硬性约束：",
    "- summary 必须是非空字符串。",
    "- artifacts 必须是字符串数组；如本次无需工件，可返回空数组。",
    "- artifactReady / phaseCompleted 如未提供，系统会按 true 处理。",
    "- 不能把 artifacts 写成对象数组、路径数组或解释性文本。",
    "- 不能推进 Workflow 状态，不能假扮 Intake，不能直接写工件。",
    "",
    "## 角色能力边界",
    "",
    `- roleName: ${roleName}`,
    `- executionMode: ${executionProfile.mode}`,
    `- sideEffects: ${executionProfile.sideEffects}`,
    `- focus: ${executionProfile.focus}`,
    `- allowedActions: ${executionProfile.allowedActions.join(", ")}`,
    "",
    "## ExecutionContext",
    "",
    `- taskId: ${context.taskId}`,
    `- phase: ${context.phase}`,
    `- cwd: ${context.cwd}`,
    `- workflowProfileId: ${context.projectConfig.workflowProfileId}`,
    `- workflowProfileLabel: ${context.projectConfig.workflowProfileLabel}`,
    "",
    context.phase === "clarify"
      ? [
          "## Clarify 特殊约束",
          "",
          "- metadata.decision 必须是 ask_next_question 或 ready_for_prd。",
          '- 当 decision=ask_next_question 时，metadata.question 必须是非空字符串，artifacts 应保持为空数组。',
          "- 当 decision=ready_for_prd 时，不要直接输出最终 PRD；由 Workflow 另起一次调用生成正式 PRD。",
          "",
        ].join("\n")
      : "",
    "## 当前输入",
    "",
    input || "(empty)",
    "",
    "## 可见工件",
    "",
    visibleArtifacts.length > 0
      ? visibleArtifacts
          .map(
            (artifact) =>
              [`### ${artifact.key}`, "", artifact.content].join("\n"),
          )
          .join("\n\n")
      : "(none)",
  ].join("\n");
}

async function loadVisibleArtifacts(
  artifactReader: ArtifactReader,
): Promise<VisibleArtifact[]> {
  const keys = await artifactReader.list();
  const visibleArtifacts: VisibleArtifact[] = [];

  for (const key of keys) {
    const content = await artifactReader.get(key);

    if (!content) {
      continue;
    }

    // Role 层只能读取当前阶段暴露出来的工件快照，
    // 不持有 ArtifactManager，也不在这里做任何写入。
    visibleArtifacts.push({
      key,
      content,
    });
  }

  return visibleArtifacts;
}

function buildStubRoleResult(
  bootstrap: RoleAgentBootstrap,
  roleName: RoleName,
  executionProfile: RoleCapabilityProfile,
  context: ExecutionContext,
  input: string,
  visibleArtifacts: VisibleArtifact[],
  executionPrompt: string,
): RoleResult {
  if (context.phase === "clarify") {
    const isFinalPrdGeneration = input.includes("正式生成 PRD");

    if (isFinalPrdGeneration) {
      return {
        summary: "clarifier 已基于初始需求与问答生成最终 PRD。",
        artifacts: [
          [
            "# Clarify PRD",
            "",
            "- generatedBy: stub",
            `- taskId: ${context.taskId}`,
            `- role: ${roleName}`,
          ].join("\n"),
        ],
        artifactReady: true,
        phaseCompleted: true,
        metadata: {
          agentConfigured: true,
          visibleSummaryDelivered: true,
          executionMode: "stub",
          agentExecutor: "stub",
          agentModel: bootstrap.config.model,
          promptSources: bootstrap.promptSources,
          promptWarnings: bootstrap.promptWarnings,
          executionProfile,
          visibleArtifactKeys: visibleArtifacts.map((artifact) => artifact.key),
          decision: "final_prd_generated",
        },
      };
    }

    return {
      summary: `${roleName} 已通过 stub Agent 完成澄清判断。`,
      artifacts: [],
      artifactReady: true,
      phaseCompleted: true,
      metadata: {
        agentConfigured: true,
        visibleSummaryDelivered: true,
        executionMode: "stub",
        agentExecutor: "stub",
        agentModel: bootstrap.config.model,
        promptSources: bootstrap.promptSources,
        promptWarnings: bootstrap.promptWarnings,
        executionProfile,
        visibleArtifactKeys: visibleArtifacts.map((artifact) => artifact.key),
        decision: "ready_for_prd",
      },
    };
  }

  const artifactSections = [
    `# ${context.phase} ${roleName} Result`,
    "",
    `- role: ${roleName}`,
    `- phase: ${context.phase}`,
    `- taskId: ${context.taskId}`,
    `- executionMode: stub`,
    `- profileMode: ${executionProfile.mode}`,
    `- sideEffects: ${executionProfile.sideEffects}`,
    `- focus: ${executionProfile.focus}`,
    `- input: ${input || "(empty)"}`,
    "",
    "## Allowed Actions",
    ...executionProfile.allowedActions.map((action) => `- ${action}`),
    "",
    "## Prompt Sources",
    ...bootstrap.promptSources.map((source) => `- ${source}`),
    "",
    "## Visible Artifacts",
    ...(visibleArtifacts.length > 0
      ? visibleArtifacts.map((artifact) => `- ${artifact.key}`)
      : ["- (none)"]),
    "",
    "## Execution Prompt Preview",
    "",
    "```text",
    executionPrompt,
    "```",
  ];

  return {
    summary: `${roleName} 已通过 stub Agent 执行 ${context.phase} 阶段。`,
    artifacts: [artifactSections.join("\n")],
    artifactReady: true,
    phaseCompleted: true,
    metadata: {
      // stub 只服务测试与离线校验，元信息里显式打标，
      // 避免把它误认为正式生产链路。
      agentConfigured: true,
      visibleSummaryDelivered: true,
      executionMode: "stub",
      agentExecutor: "stub",
      agentModel: bootstrap.config.model,
      promptSources: bootstrap.promptSources,
      promptWarnings: bootstrap.promptWarnings,
      executionProfile,
      visibleArtifactKeys: visibleArtifacts.map((artifact) => artifact.key),
    },
  };
}

function parseRoleResultPayload(rawContent: string): RoleResult {
  const payloadText = extractJsonPayload(rawContent);

  try {
    const parsed = JSON.parse(payloadText) as {
      summary?: unknown;
      artifacts?: unknown;
      artifactReady?: unknown;
      phaseCompleted?: unknown;
      metadata?: unknown;
    };
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const artifacts = Array.isArray(parsed.artifacts)
      ? parsed.artifacts.filter((item): item is string => typeof item === "string")
      : [];
    const artifactReady =
      typeof parsed.artifactReady === "boolean" ? parsed.artifactReady : true;
    const phaseCompleted =
      typeof parsed.phaseCompleted === "boolean" ? parsed.phaseCompleted : true;

    if (!summary) {
      throw new Error("Role agent response summary is empty.");
    }

    return {
      summary,
      artifacts,
      artifactReady,
      phaseCompleted,
      metadata:
        parsed.metadata && typeof parsed.metadata === "object"
          ? (parsed.metadata as Record<string, unknown>)
          : undefined,
    };
  } catch {
    // 模型没有严格遵守 JSON 协议时，仍尽量把原始回答收敛成结构化结果，
    // 避免一次格式偏差直接让整个 Workflow 崩掉。
    return {
      summary: rawContent.trim() || "Role agent returned empty content.",
      artifacts: rawContent.trim().length > 0 ? [rawContent.trim()] : [],
      artifactReady: true,
      phaseCompleted: true,
      metadata: {
        parseFallback: true,
      },
    };
  }
}

function extractJsonPayload(content: string): string {
  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);

  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return content.slice(firstBrace, lastBrace + 1).trim();
  }

  return content.trim();
}

import { ChatOpenAI } from "@langchain/openai";
import type {
  ArtifactReader,
  ExecutionContext,
  RoleCapabilityProfile,
  RoleName,
  RoleResult,
  RoleRuntime,
} from "../shared/types";
import { resolveRoleModelConfig } from "./config";
import { buildRolePrompt } from "./prompts";

export interface RoleAgentBootstrap {
  llm: ChatOpenAI;
  prompt: string;
  promptSources: string[];
  promptWarnings: string[];
  config: ReturnType<typeof resolveRoleModelConfig>;
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
  const config = resolveRoleModelConfig();
  const promptBundle = await buildRolePrompt(roleName, roleRuntime.projectConfig);
  // 角色 Agent 初始化刻意不传 temperature，
  // 以符合 role-layer 计划文档对统一模型入口的约束。
  const llm = new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    configuration: {
      baseURL: config.baseUrl,
    },
  });

  return {
    llm,
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
  const executionPrompt = buildRoleExecutionPrompt(
    input.bootstrap.prompt,
    input.roleName,
    input.executionProfile,
    input.context,
    input.input,
    visibleArtifacts,
  );

  if (input.bootstrap.config.executionMode === "stub") {
    return buildStubRoleResult(
      input.bootstrap,
      input.roleName,
      input.executionProfile,
      input.context,
      input.input,
      visibleArtifacts,
      executionPrompt,
    );
  }

  // 默认执行模式必须真实调用模型，不能只初始化 Agent 而不执行。
  const response = await input.bootstrap.llm.invoke(executionPrompt);
  const rawContent = normalizeModelContent((response as { content?: unknown }).content);
  const parsed = parseRoleResultPayload(rawContent);

  return {
    summary: parsed.summary,
    artifacts: parsed.artifacts,
    metadata: {
      ...parsed.metadata,
      agentConfigured: true,
      executionMode: input.bootstrap.config.executionMode,
      promptSources: input.bootstrap.promptSources,
      promptWarnings: input.bootstrap.promptWarnings,
      executionProfile: input.executionProfile,
      visibleArtifactKeys: visibleArtifacts.map((artifact) => artifact.key),
    },
  };
}

function buildRoleExecutionPrompt(
  basePrompt: string,
  roleName: RoleName,
  executionProfile: RoleCapabilityProfile,
  context: ExecutionContext,
  input: string,
  visibleArtifacts: VisibleArtifact[],
): string {
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
    '  "metadata": { "可选附加元信息": "任意 JSON 值" }',
    "}",
    "",
    "硬性约束：",
    "- summary 必须是非空字符串。",
    "- artifacts 必须是字符串数组；如本次无需工件，可返回空数组。",
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
    metadata: {
      agentConfigured: true,
      executionMode: "stub",
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
      metadata?: unknown;
    };
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    const artifacts = Array.isArray(parsed.artifacts)
      ? parsed.artifacts.filter((item): item is string => typeof item === "string")
      : [];

    if (!summary) {
      throw new Error("Role agent response summary is empty.");
    }

    return {
      summary,
      artifacts,
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

function normalizeModelContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (
          item &&
          typeof item === "object" &&
          "text" in item &&
          typeof (item as { text?: unknown }).text === "string"
        ) {
          return (item as { text: string }).text;
        }

        return JSON.stringify(item);
      })
      .join("\n");
  }

  return content == null ? "" : String(content);
}

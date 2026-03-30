import { promises as fs } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type {
  ExecutionContext,
  RoleCapabilityProfile,
  RoleName,
} from "../shared/types";
import type { RoleCodexConfig } from "./config";

let executionSequence = 0;

export interface RoleAgentExecutionRequest {
  roleName: RoleName;
  prompt: string;
  context: ExecutionContext;
  executionProfile: RoleCapabilityProfile;
  config: RoleCodexConfig;
}

export interface RoleAgentExecutor {
  readonly executorKind: string;
  execute(input: RoleAgentExecutionRequest): Promise<string>;
}

interface CodexCliExecutorDependencies {
  runCommand?: (
    file: string,
    args: string[],
    options: {
      cwd: string;
      input: string;
      env: Record<string, string | undefined>;
    },
  ) => Promise<unknown>;
}

export class CodexCliRoleAgentExecutor implements RoleAgentExecutor {
  public readonly executorKind = "codex-cli";

  public constructor(
    private readonly dependencies: CodexCliExecutorDependencies = {},
  ) {}

  public async execute(input: RoleAgentExecutionRequest): Promise<string> {
    // 角色执行结果先落到项目内缓存文件，再回读成字符串，
    // 这样可以避免把终端事件流当成最终结构化输出来源。
    const outputPath = buildRoleAgentOutputPath(input);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    try {
      // 角色执行器统一通过 codex exec 发起请求，
      // 明确与通用聊天接口分离，避免默认角色再次退化成直接 llm.invoke(prompt)。
      await (this.dependencies.runCommand ?? execa)(
        "codex",
        [
          "exec",
          "--full-auto",
          "--skip-git-repo-check",
          "--sandbox",
          // 只读角色禁止副作用，交给 Codex 时也同步收紧 sandbox；
          // builder / tester 这类允许副作用的角色才给 workspace-write。
          input.executionProfile.sideEffects === "allowed"
            ? "workspace-write"
            : "read-only",
          "--cd",
          input.context.cwd,
          "--model",
          input.config.model,
          "--output-last-message",
          outputPath,
          "-",
        ],
        {
          cwd: input.context.cwd,
          input: input.prompt,
          env: {
            ...process.env,
            // Codex 侧统一复用角色层收敛后的配置结果，
            // 避免执行器内部再自行推导模型鉴权入口。
            OPENAI_API_KEY: input.config.apiKey,
            OPENAI_BASE_URL: input.config.baseUrl,
          },
        },
      );

      return await fs.readFile(outputPath, "utf8");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown codex execution error";

      throw new Error(`Role Codex agent execution failed: ${message}`);
    }
  }
}

export function buildRoleAgentOutputPath(
  input: Pick<RoleAgentExecutionRequest, "roleName" | "context">,
): string {
  const sequence = executionSequence++;
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  return path.join(
    input.context.cwd,
    ".aegisflow",
    "runtime-cache",
    [
      "role-agent",
      sanitizeCacheSegment(input.context.taskId),
      sanitizeCacheSegment(input.context.phase),
      sanitizeCacheSegment(input.roleName),
      String(Date.now()),
      String(sequence),
      randomSuffix,
      "last-message.txt",
    ].join("-"),
  );
}

function sanitizeCacheSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

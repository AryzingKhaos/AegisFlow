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
  shutdown?(): Promise<void>;
}

interface CodexCliExecutorDependencies {
  runCommand?: (
    file: string,
    args: string[],
    options: {
      cwd: string;
      input: string;
      env: Record<string, string | undefined>;
      timeoutMs: number;
      onStdoutLine?: (line: string) => void;
    },
  ) => Promise<unknown>;
}

export class CodexCliRoleAgentExecutor implements RoleAgentExecutor {
  public readonly executorKind = "codex-cli";
  private sessionId?: string;

  public constructor(
    private readonly dependencies: CodexCliExecutorDependencies = {},
  ) {}

  public async execute(input: RoleAgentExecutionRequest): Promise<string> {
    // 角色执行结果先落到项目内缓存文件，再回读成字符串，
    // 这样可以避免把终端事件流当成最终结构化输出来源。
    const outputPath = buildRoleAgentOutputPath(input);
    let pendingVisibleOutput = Promise.resolve();
    let nextSessionId = this.sessionId;
    const executorConfig = input.context.projectConfig.roleExecutor;

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    try {
      // 角色执行器统一通过 codex exec 发起请求，
      // 明确与通用聊天接口分离，避免默认角色再次退化成直接 llm.invoke(prompt)。
      await (this.dependencies.runCommand ?? runStreamingCodexCommand)(
        executorConfig.command,
        buildCodexCommandArgs(input, outputPath, this.sessionId),
        {
          cwd: executorConfig.cwd,
          input: input.prompt,
          env: buildExecutorEnv(input),
          timeoutMs: executorConfig.timeoutMs,
          onStdoutLine: (line: string) => {
            const discoveredSessionId = extractSessionIdFromCodexEventLine(line);

            if (discoveredSessionId) {
              nextSessionId = discoveredSessionId;
            }

            const visibleMessages = extractVisibleMessagesFromCodexEventLine(line);

            for (const message of visibleMessages) {
              pendingVisibleOutput = pendingVisibleOutput.then(async () => {
                await input.context.emitVisibleOutput?.({
                  message,
                  kind: "progress",
                });
              });
            }
          },
        },
      );
      await pendingVisibleOutput;
      this.sessionId = nextSessionId;

      return await fs.readFile(outputPath, "utf8");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown codex execution error";

      throw new Error(`Role Codex agent execution failed: ${message}`);
    }
  }

  public async shutdown(): Promise<void> {
    // 当前 session 通过 thread/session id 复用；
    // 任务终态时清空本地引用即可结束 AegisFlow 侧生命周期，避免后续继续 resume。
    this.sessionId = undefined;
  }
}

export async function runStreamingCodexCommand(
  file: string,
  args: string[],
  options: {
    cwd: string;
    input: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
    onStdoutLine?: (line: string) => void;
  },
): Promise<void> {
  const subprocess = execa(file, args, {
    cwd: options.cwd,
    input: options.input,
    env: options.env,
    timeout: options.timeoutMs,
  });
  const stdoutStream = (
    subprocess as unknown as {
      stdout?: {
        on: (
          event: string,
          listener: (chunk: unknown) => void,
        ) => void;
      };
    }
  ).stdout;
  let stdoutBuffer = "";

  stdoutStream?.on("data", (chunk: unknown) => {
    stdoutBuffer += normalizeProcessChunk(chunk);
    stdoutBuffer = flushStdoutLines(stdoutBuffer, options.onStdoutLine);
  });

  await subprocess;

  const trailingLine = stdoutBuffer.trim();

  if (trailingLine) {
    options.onStdoutLine?.(trailingLine);
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

function flushStdoutLines(
  buffer: string,
  onStdoutLine?: (line: string) => void,
): string {
  let cursor = buffer.indexOf("\n");
  let remaining = buffer;

  while (cursor >= 0) {
    const line = remaining.slice(0, cursor).trim();

    if (line) {
      onStdoutLine?.(line);
    }

    remaining = remaining.slice(cursor + 1);
    cursor = remaining.indexOf("\n");
  }

  return remaining;
}

function normalizeProcessChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (chunk && typeof chunk === "object" && "toString" in chunk) {
    return String((chunk as { toString: () => string }).toString());
  }

  return String(chunk ?? "");
}

function buildCodexCommandArgs(
  input: RoleAgentExecutionRequest,
  outputPath: string,
  sessionId?: string,
): string[] {
  const baseArgs = sessionId
    ? [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "--output-last-message",
        outputPath,
        sessionId,
        "-",
      ]
    : [
        "exec",
        "--json",
        "--full-auto",
        "--skip-git-repo-check",
        "--sandbox",
        input.executionProfile.sideEffects === "allowed"
          ? "workspace-write"
          : "read-only",
        "--cd",
        input.context.projectConfig.roleExecutor.cwd,
        "--model",
        input.config.model,
        "--output-last-message",
        outputPath,
        "-",
      ];

  return baseArgs;
}

function buildExecutorEnv(
  input: RoleAgentExecutionRequest,
): Record<string, string | undefined> {
  const passthrough =
    input.context.projectConfig.roleExecutor.env.passthrough;
  const baseEnv = passthrough ? { ...process.env } : {};

  return {
    ...baseEnv,
    // Codex 侧统一复用角色层收敛后的配置结果，
    // 避免执行器内部再自行推导模型鉴权入口。
    OPENAI_API_KEY: input.config.apiKey,
    OPENAI_BASE_URL: input.config.baseUrl,
  };
}

function extractVisibleMessagesFromCodexEventLine(line: string): string[] {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedLine) as Record<string, unknown>;

    return collectVisibleMessages(parsed).filter((message) => message.trim().length > 0);
  } catch {
    return shouldSuppressPlainStdoutLine(trimmedLine) ? [] : [trimmedLine];
  }
}

function extractSessionIdFromCodexEventLine(line: string): string | undefined {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmedLine) as Record<string, unknown>;

    if (
      parsed.type === "thread.started" &&
      typeof parsed.thread_id === "string" &&
      parsed.thread_id.trim().length > 0
    ) {
      return parsed.thread_id.trim();
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function collectVisibleMessages(payload: Record<string, unknown>): string[] {
  const eventType = typeof payload.type === "string" ? payload.type : "";
  const messages: string[] = [];

  pushIfPresent(messages, payload.message);
  pushIfPresent(messages, payload.delta);
  pushIfPresent(messages, payload.text);
  pushIfPresent(messages, payload.output_text);

  collectNestedText(messages, payload.content);
  collectNestedText(messages, payload.item);
  collectNestedText(messages, payload.response);

  if (messages.length > 0) {
    return messages;
  }

  return shouldSuppressJsonEvent(eventType) ? [] : [];
}

function collectNestedText(target: string[], value: unknown): void {
  if (typeof value === "string") {
    pushIfPresent(target, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectNestedText(target, item);
    }

    return;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    pushIfPresent(target, record.message);
    pushIfPresent(target, record.delta);
    pushIfPresent(target, record.text);
    pushIfPresent(target, record.output_text);

    for (const nestedValue of Object.values(record)) {
      if (nestedValue !== value) {
        collectNestedText(target, nestedValue);
      }
    }
  }
}

function pushIfPresent(target: string[], value: unknown): void {
  if (typeof value !== "string") {
    return;
  }

  const normalized = normalizeVisibleText(value);

  if (!normalized || shouldSuppressPlainStdoutLine(normalized)) {
    return;
  }

  target.push(normalized);
}

function shouldSuppressJsonEvent(eventType: string): boolean {
  return (
    eventType === "thread.started" ||
    eventType === "thread.completed" ||
    eventType === "turn.started" ||
    eventType === "turn.completed"
  );
}

function shouldSuppressPlainStdoutLine(line: string): boolean {
  return (
    line.startsWith("WARNING: proceeding") ||
    line.startsWith("note: run with") ||
    line.startsWith("thread '") ||
    line.startsWith("Could not create otel exporter") ||
    /^\d{4}-\d{2}-\d{2}T/.test(line)
  );
}

function normalizeVisibleText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .trim();
}

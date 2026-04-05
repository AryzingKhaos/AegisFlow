import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ExecutionContext,
  RoleCapabilityProfile,
  RoleName,
} from "../shared/types";
import type { RoleCodexConfig } from "./config";

let executionSequence = 0;
declare const require: (id: string) => unknown;
declare function setTimeout(
  handler: (...args: unknown[]) => void,
  timeout?: number,
): unknown;
declare function clearTimeout(handle: unknown): void;

interface SpawnedProcess {
  stdin: {
    write(chunk: string): void;
    end(): void;
  };
  stdout: {
    on(event: "data", listener: (chunk: unknown) => void): void;
  };
  stderr: {
    on(event: "data", listener: (chunk: unknown) => void): void;
  };
  on(event: "error", listener: (error: Error) => void): void;
  on(
    event: "close",
    listener: (code: number | null, signal: string | null) => void,
  ): void;
  kill(signal?: string): void;
}

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

export interface TransportExecutionRequest {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  onStdoutLine?: (line: string) => void;
}

export interface CliTransport {
  readonly transportKind: string;
  execute(request: TransportExecutionRequest): Promise<void>;
}

export interface ProviderExecutionRequest {
  command: string;
  args: string[];
  cwd: string;
  stdin: string;
  env: Record<string, string | undefined>;
  timeoutMs: number;
  onStdoutLine?: (line: string) => void;
  flushVisibleOutput?(): Promise<void>;
  readResult(): Promise<string>;
}

export interface CliProvider {
  readonly providerKind: string;
  prepareExecution(input: RoleAgentExecutionRequest): Promise<ProviderExecutionRequest>;
}

export interface ChildProcessTransportDependencies {
  runProcess?: (request: TransportExecutionRequest) => Promise<void>;
}

export interface CodexCliExecutorDependencies {
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
  ) => Promise<void>;
}

export class ChildProcessCliTransport implements CliTransport {
  public readonly transportKind = "child_process";

  public constructor(
    private readonly dependencies: ChildProcessTransportDependencies = {},
  ) {}

  public async execute(request: TransportExecutionRequest): Promise<void> {
    if (this.dependencies.runProcess) {
      await this.dependencies.runProcess(request);
      return;
    }

    await runChildProcess(request);
  }
}

export interface CodexCliProviderDependencies {
  buildOutputPath?: (
    input: Pick<RoleAgentExecutionRequest, "roleName" | "context">,
  ) => string;
}

export class CodexCliProvider implements CliProvider {
  public readonly providerKind = "codex";

  public constructor(
    private readonly dependencies: CodexCliProviderDependencies = {},
  ) {}

  public async prepareExecution(
    input: RoleAgentExecutionRequest,
  ): Promise<ProviderExecutionRequest> {
    const outputPath =
      this.dependencies.buildOutputPath?.(input) ?? buildRoleAgentOutputPath(input);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    let pendingVisibleOutput = Promise.resolve();

    return {
      command: input.context.projectConfig.roleExecutor.provider.command,
      args: buildCodexCommandArgs(input, outputPath),
      cwd: input.context.projectConfig.roleExecutor.transport.cwd,
      stdin: "",
      env: buildExecutorEnv(input),
      timeoutMs: input.context.projectConfig.roleExecutor.transport.timeoutMs,
      onStdoutLine: input.context.emitVisibleOutput
        ? visibleLineEmitter(
            input.context.emitVisibleOutput,
            (nextPendingOutput) => {
              pendingVisibleOutput = nextPendingOutput;
            },
            () => pendingVisibleOutput,
          )
        : undefined,
      flushVisibleOutput: async () => pendingVisibleOutput,
      readResult: async () => fs.readFile(outputPath, "utf8"),
    };
  }
}

interface DefaultRoleAgentExecutorDependencies {
  transport?: CliTransport;
  provider?: CliProvider;
}

export class DefaultRoleAgentExecutor implements RoleAgentExecutor {
  public readonly executorKind: string;
  private readonly transport: CliTransport;
  private readonly provider: CliProvider;

  public constructor(
    dependencies: DefaultRoleAgentExecutorDependencies = {},
  ) {
    this.transport = dependencies.transport ?? new ChildProcessCliTransport();
    this.provider = dependencies.provider ?? new CodexCliProvider();
    this.executorKind = `${this.transport.transportKind}:${this.provider.providerKind}`;
  }

  public async execute(input: RoleAgentExecutionRequest): Promise<string> {
    try {
      const request = await this.provider.prepareExecution(input);
      await this.transport.execute(request);
      await request.flushVisibleOutput?.();
      return await request.readResult();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown role execution error";

      throw new Error(`Role agent execution failed: ${message}`);
    }
  }
}

export function createRoleAgentExecutor(): RoleAgentExecutor {
  return new DefaultRoleAgentExecutor();
}

export class CodexCliRoleAgentExecutor extends DefaultRoleAgentExecutor {
  public constructor(
    dependencies: CodexCliExecutorDependencies = {},
  ) {
    super({
      transport: new ChildProcessCliTransport({
        runProcess: async (request) => {
          if (dependencies.runCommand) {
            await dependencies.runCommand(request.command, request.args, {
              cwd: request.cwd,
              input: request.stdin,
              env: request.env,
              timeoutMs: request.timeoutMs,
              onStdoutLine: request.onStdoutLine,
            });
            return;
          }

          await runChildProcess(request);
        },
      }),
      provider: new CodexCliProvider(),
    });
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

async function runChildProcess(
  request: TransportExecutionRequest,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const childProcessModule = require("child_process") as {
      spawn(
        command: string,
        args: string[],
        options: {
          cwd: string;
          env: Record<string, string>;
          stdio: ["pipe", "pipe", "pipe"];
        },
      ): SpawnedProcess;
    };
    const child = childProcessModule.spawn(request.command, request.args, {
      cwd: request.cwd,
      env: buildSpawnEnv(request.env),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let timeoutReached = false;
    const timer = setTimeout(() => {
      timeoutReached = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);

    child.stdout.on("data", (chunk: unknown) => {
      stdoutBuffer = flushStdoutLines(
        `${stdoutBuffer}${normalizeProcessChunk(chunk)}`,
        request.onStdoutLine,
      );
    });

    child.stderr.on("data", (chunk: unknown) => {
      stderrBuffer += normalizeProcessChunk(chunk);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);

      if (stdoutBuffer.length > 0) {
        request.onStdoutLine?.(stdoutBuffer.replace(/\r$/, ""));
      }

      if (timeoutReached) {
        reject(new Error(`command timed out after ${String(request.timeoutMs)}ms`));
        return;
      }

      if (code !== 0) {
        const failureReason = stderrBuffer.trim() || `process exited with code ${String(code)}`;
        reject(
          new Error(
            signal ? `${failureReason} (signal: ${signal})` : failureReason,
          ),
        );
        return;
      }

      resolve();
    });

    if (request.stdin.length > 0) {
      child.stdin.write(request.stdin);
    }

    child.stdin.end();
  });
}

function flushStdoutLines(
  buffer: string,
  onStdoutLine?: (line: string) => void,
): string {
  let cursor = buffer.indexOf("\n");
  let remaining = buffer;

  while (cursor >= 0) {
    const line = remaining.slice(0, cursor).replace(/\r$/, "");
    onStdoutLine?.(line);
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

function buildSpawnEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const nextEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }

    nextEnv[key] = value;
  }

  return nextEnv;
}

function visibleLineEmitter(
  emitVisibleOutput: NonNullable<ExecutionContext["emitVisibleOutput"]>,
  setPendingOutput: (value: Promise<void>) => void,
  getPendingOutput: () => Promise<void>,
): (line: string) => void {
  return (line: string) => {
    const visibleMessages = extractVisibleMessagesFromCodexEventLine(line);

    for (const message of visibleMessages) {
      const nextPendingOutput = getPendingOutput().then(async () => {
        await emitVisibleOutput({
          message,
          kind: "progress",
        });
      });

      setPendingOutput(nextPendingOutput);
    }
  };
}

function buildCodexCommandArgs(
  input: RoleAgentExecutionRequest,
  outputPath: string,
): string[] {
  return [
    "exec",
    "--json",
    "--full-auto",
    "--skip-git-repo-check",
    "--sandbox",
    input.executionProfile.sideEffects === "allowed"
      ? "workspace-write"
      : "read-only",
    "--cd",
    input.context.projectConfig.roleExecutor.transport.cwd,
    "--model",
    input.config.model,
    ...buildCodexConfigOverrides(input.config),
    "--output-last-message",
    outputPath,
    input.prompt,
  ];
}

function buildCodexConfigOverrides(config: RoleCodexConfig): string[] {
  return ["-c", `openai_base_url=${JSON.stringify(config.baseUrl)}`];
}

function buildExecutorEnv(
  input: RoleAgentExecutionRequest,
): Record<string, string | undefined> {
  const passthrough =
    input.context.projectConfig.roleExecutor.transport.env.passthrough;
  const baseEnv = passthrough ? { ...process.env } : {};

  return {
    ...baseEnv,
    OPENAI_API_KEY: input.config.apiKey,
  };
}

function extractVisibleMessagesFromCodexEventLine(line: string): string[] {
  const trimmedLine = line.trim();

  if (line.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmedLine) as Record<string, unknown>;

    return collectVisibleMessages(parsed).filter((message) => message.length > 0);
  } catch {
    return shouldSuppressPlainStdoutLine(trimmedLine) ? [] : [line];
  }
}

function collectVisibleMessages(payload: Record<string, unknown>): string[] {
  const eventType = typeof payload.type === "string" ? payload.type : "";
  const messages: string[] = [];
  const approvalMessages = collectApprovalRequestMessages(payload);

  pushIfPresent(messages, payload.message);
  pushIfPresent(messages, payload.delta);
  pushIfPresent(messages, payload.text);
  pushIfPresent(messages, payload.output_text);

  collectNestedText(messages, payload.content);
  collectNestedText(messages, payload.item);
  collectNestedText(messages, payload.response);

  if (messages.length > 0) {
    return [...messages, ...approvalMessages];
  }

  if (approvalMessages.length > 0) {
    return approvalMessages;
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

  const normalized = value;

  if (normalized.length === 0) {
    return;
  }

  if (
    normalized.trim().length > 0 &&
    shouldSuppressPlainStdoutLine(normalized.trim())
  ) {
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

function collectApprovalRequestMessages(payload: Record<string, unknown>): string[] {
  const messages: string[] = [];

  collectApprovalMessagesFromValue(payload, messages, new Set<unknown>());

  return [...new Set(messages)];
}

function collectApprovalMessagesFromValue(
  value: unknown,
  target: string[],
  seen: Set<unknown>,
): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);

  const record = value as Record<string, unknown>;
  const approvalMessage = formatApprovalRequestMessage(record);

  if (approvalMessage) {
    target.push(approvalMessage);
  }

  for (const nestedValue of Object.values(record)) {
    collectApprovalMessagesFromValue(nestedValue, target, seen);
  }
}

function formatApprovalRequestMessage(record: Record<string, unknown>): string | undefined {
  const toolName = resolveApprovalToolName(record);
  const parameters = resolveApprovalParameters(record);

  if (!toolName || !parameters) {
    return undefined;
  }

  const sandboxPermissions =
    typeof parameters.sandbox_permissions === "string"
      ? parameters.sandbox_permissions
      : undefined;
  const justification =
    typeof parameters.justification === "string" ? parameters.justification : undefined;
  const command = typeof parameters.cmd === "string" ? parameters.cmd : undefined;
  const path = typeof parameters.path === "string" ? parameters.path : undefined;

  if (sandboxPermissions !== "require_escalated") {
    return undefined;
  }

  const lines = [`[审批请求] ${toolName}`];

  if (justification) {
    lines.push(`说明: ${justification}`);
  }

  if (command) {
    lines.push(`命令: ${command}`);
  }

  if (path) {
    lines.push(`路径: ${path}`);
  }

  if (sandboxPermissions) {
    lines.push(`权限: ${sandboxPermissions}`);
  }

  const prefixRule = parameters.prefix_rule;

  if (Array.isArray(prefixRule) && prefixRule.every((item) => typeof item === "string")) {
    lines.push(`复用前缀: ${prefixRule.join(" ")}`);
  }

  return lines.join("\n");
}

function resolveApprovalToolName(record: Record<string, unknown>): string | undefined {
  const directName =
    typeof record.recipient_name === "string"
      ? record.recipient_name
      : typeof record.tool_name === "string"
        ? record.tool_name
        : typeof record.name === "string"
          ? record.name
          : undefined;

  if (directName) {
    return directName;
  }

  const toolCall = record.tool_call;

  if (toolCall && typeof toolCall === "object") {
    return resolveApprovalToolName(toolCall as Record<string, unknown>);
  }

  return undefined;
}

function resolveApprovalParameters(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const directParameters = pickApprovalParameterRecord(record.parameters);

  if (directParameters) {
    return directParameters;
  }

  const directArgs = pickApprovalParameterRecord(record.args);

  if (directArgs) {
    return directArgs;
  }

  const directInput = pickApprovalParameterRecord(record.input);

  if (directInput) {
    return directInput;
  }

  const toolCall = record.tool_call;

  if (toolCall && typeof toolCall === "object") {
    return resolveApprovalParameters(toolCall as Record<string, unknown>);
  }

  return undefined;
}

function pickApprovalParameterRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

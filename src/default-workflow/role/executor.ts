import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ExecutionContext,
  RoleCapabilityProfile,
  RoleName,
  TaskDebugEvent,
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
  onStdoutLine?: (line: string) => void | Promise<void>;
  onStderrChunk?: (chunk: string) => void | Promise<void>;
  onExit?: (result: {
    code: number | null;
    signal: string | null;
    timedOut: boolean;
    stderr: string;
    stdoutRemainder?: string;
  }) => void | Promise<void>;
  onTransportError?: (error: Error) => void | Promise<void>;
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
  onStdoutLine?: (line: string) => void | Promise<void>;
  onStderrChunk?: (chunk: string) => void | Promise<void>;
  onExit?: (result: {
    code: number | null;
    signal: string | null;
    timedOut: boolean;
    stderr: string;
    stdoutRemainder?: string;
  }) => void | Promise<void>;
  onTransportError?: (error: Error) => void | Promise<void>;
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
      onStdoutLine?: (line: string) => void | Promise<void>;
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
      const instrumentedRequest: ProviderExecutionRequest = {
        ...request,
        onStdoutLine: chainStdoutHandlers(request.onStdoutLine, async (line) => {
          await emitExecutionDebugEvent(input.context, {
            type: "executor_stdout",
            source: "executor",
            phase: input.context.phase,
            roleName: input.roleName,
            message: line,
          });
        }),
        onStderrChunk: async (chunk) => {
          await request.onStderrChunk?.(chunk);
          await emitExecutionDebugEvent(input.context, {
            type: "executor_stderr",
            source: "executor",
            level: "error",
            phase: input.context.phase,
            roleName: input.roleName,
            message: chunk,
          });
        },
        onExit: async (result) => {
          await request.onExit?.(result);
          await emitExecutionDebugEvent(input.context, {
            type: "executor_exit",
            source: "executor",
            level:
              result.timedOut ||
              result.code !== 0 ||
              (typeof result.signal === "string" && result.signal.length > 0)
                ? "error"
                : "info",
            phase: input.context.phase,
            roleName: input.roleName,
            message:
              result.timedOut
                ? `executor timed out after ${String(request.timeoutMs)}ms`
                : `executor exited with code ${String(result.code ?? 0)}`,
            metadata: {
              command: request.command,
              args: request.args,
              cwd: request.cwd,
              timeoutMs: request.timeoutMs,
              code: result.code,
              signal: result.signal,
              timedOut: result.timedOut,
            },
          });
        },
        onTransportError: async (error) => {
          await request.onTransportError?.(error);
          await emitExecutionDebugEvent(input.context, {
            type: "error",
            source: "executor",
            level: "error",
            phase: input.context.phase,
            roleName: input.roleName,
            message: "executor transport error",
            metadata: {
              rawError: error.message,
              command: request.command,
              args: request.args,
              cwd: request.cwd,
            },
          });
        },
      };

      await this.transport.execute(instrumentedRequest);
      await instrumentedRequest.flushVisibleOutput?.();
      const result = await instrumentedRequest.readResult();
      await emitExecutionDebugEvent(input.context, {
        type: "executor_result_payload",
        source: "executor",
        phase: input.context.phase,
        roleName: input.roleName,
        message: "executor returned final raw payload",
        payload: result,
        metadata: {
          command: request.command,
          args: request.args,
          cwd: request.cwd,
        },
      });
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "unknown role execution error";

      await emitExecutionDebugEvent(input.context, {
        type: "error",
        source: "executor",
        level: "error",
        phase: input.context.phase,
        roleName: input.roleName,
        message: "Role agent execution failed.",
        metadata: {
          rawError: message,
        },
      });

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
    let settled = false;
    let callbackQueue = Promise.resolve();
    const timer = setTimeout(() => {
      timeoutReached = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);

    const settleResolve = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const settleReject = (error: unknown): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      reject(normalizeUnknownError(error));
    };

    const enqueueCallback = (
      operation: () => void | Promise<void>,
    ): Promise<void> => {
      const next = callbackQueue.then(operation);
      callbackQueue = next.catch(() => {});
      return next;
    };

    const observeCallback = (
      operation: () => void | Promise<void>,
      options: {
        killOnError?: boolean;
        onSuccess?: () => void;
      } = {},
    ): void => {
      void enqueueCallback(operation).then(
        () => {
          options.onSuccess?.();
        },
        (error) => {
          if (options.killOnError) {
            child.kill("SIGKILL");
          }
          settleReject(error);
        },
      );
    };

    child.stdout.on("data", (chunk: unknown) => {
      if (settled) {
        return;
      }

      const normalizedChunk = normalizeProcessChunk(chunk);
      observeCallback(
        async () => {
          stdoutBuffer = await flushStdoutLines(
            `${stdoutBuffer}${normalizedChunk}`,
            request.onStdoutLine,
          );
        },
        { killOnError: true },
      );
    });

    child.stderr.on("data", (chunk: unknown) => {
      if (settled) {
        return;
      }

      const normalizedChunk = normalizeProcessChunk(chunk);
      observeCallback(
        async () => {
          stderrBuffer += normalizedChunk;
          await request.onStderrChunk?.(normalizedChunk);
        },
        { killOnError: true },
      );
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      observeCallback(async () => {
        await request.onTransportError?.(error);
        throw error;
      });
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }

      observeCallback(
        async () => {
          const stdoutRemainder =
            stdoutBuffer.length > 0 ? stdoutBuffer.replace(/\r$/, "") : undefined;

          if (stdoutRemainder) {
            stdoutBuffer = "";
            await request.onStdoutLine?.(stdoutRemainder);
          }

          await request.onExit?.({
            code,
            signal,
            timedOut: timeoutReached,
            stderr: stderrBuffer,
            stdoutRemainder,
          });

          if (timeoutReached) {
            throw new Error(`command timed out after ${String(request.timeoutMs)}ms`);
          }

          if (code !== 0) {
            const failureReason =
              stderrBuffer.trim() || `process exited with code ${String(code)}`;
            throw new Error(
              signal ? `${failureReason} (signal: ${signal})` : failureReason,
            );
          }
        },
        {
          onSuccess: () => {
            settleResolve();
          },
        },
      );
    });

    if (request.stdin.length > 0) {
      child.stdin.write(request.stdin);
    }

    child.stdin.end();
  });
}

async function flushStdoutLines(
  buffer: string,
  onStdoutLine?: (line: string) => void | Promise<void>,
): Promise<string> {
  let cursor = buffer.indexOf("\n");
  let remaining = buffer;

  while (cursor >= 0) {
    const line = remaining.slice(0, cursor).replace(/\r$/, "");
    await onStdoutLine?.(line);
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

function chainStdoutHandlers(
  primary: ((line: string) => void | Promise<void>) | undefined,
  secondary: (line: string) => Promise<void>,
): (line: string) => Promise<void> {
  return async (line: string) => {
    await primary?.(line);
    await secondary(line);
  };
}

function normalizeUnknownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error ?? "unknown child process error"));
}

async function emitExecutionDebugEvent(
  context: ExecutionContext,
  event: Omit<TaskDebugEvent, "taskId" | "timestamp"> & {
    timestamp?: number;
  },
): Promise<void> {
  await context.emitDebugEvent?.({
    ...event,
    timestamp: event.timestamp ?? Date.now(),
  });
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

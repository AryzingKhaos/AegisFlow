import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ExecutionContext,
  InputDeliveryResult,
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
  sendInput?(input: string): Promise<InputDeliveryResult>;
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
      buildFollowUpArgs?: (
        input: string,
        sessionId?: string,
      ) => string[];
    },
  ) => Promise<unknown>;
  createPersistentSession?: () => PersistentCodexCliSession;
}

export class CodexCliRoleAgentExecutor implements RoleAgentExecutor {
  public readonly executorKind = "codex-cli";
  private sessionId?: string;
  private persistentSession?: PersistentCodexCliSession;

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
      const executeCommand =
        this.dependencies.runCommand ??
        this.getPersistentSession().executeCommand.bind(this.getPersistentSession());

      // 角色执行器统一通过 codex exec 发起请求，
      // 明确与通用聊天接口分离，避免默认角色再次退化成直接 llm.invoke(prompt)。
      await executeCommand(
        executorConfig.command,
        buildCodexCommandArgs(input, outputPath, this.sessionId),
        {
          cwd: executorConfig.cwd,
          input: input.prompt,
          env: buildExecutorEnv(input),
          timeoutMs: executorConfig.timeoutMs,
          // session 只负责“如何在 PTY 里串行执行 turn”，
          // 具体 follow-up turn 的 codex 参数仍由上层执行器决定。
          buildFollowUpArgs: (liveInput: string, sessionId?: string) =>
            buildCodexParticipationCommandArgs(
              outputPath,
              input.config,
              liveInput,
              sessionId,
            ),
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

  public async sendInput(input: string): Promise<InputDeliveryResult> {
    if (input.length === 0) {
      return {
        accepted: false,
        mode: "rejected",
        reason: "empty_input",
      };
    }

    // Intake -> active role 的输入只写入当前活跃 PTY 会话；
    // inactive role 即使存在，也不会收到这条输入。
    return this.getPersistentSession().sendInput(input);
  }

  public async shutdown(): Promise<void> {
    // 当前 session 通过 thread/session id 复用；
    // Intake 生命周期结束时清空本地引用即可结束 AegisFlow 侧生命周期，避免后续继续 resume。
    this.sessionId = undefined;
    await this.persistentSession?.shutdown();
    this.persistentSession = undefined;
  }

  private getPersistentSession(): PersistentCodexCliSession {
    this.persistentSession ??=
      this.dependencies.createPersistentSession?.() ??
      createPersistentCodexCliSession();

    return this.persistentSession;
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
  const session = createPersistentCodexCliSession();

  try {
    await session.executeCommand(file, args, options);
  } finally {
    await session.shutdown();
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

function buildPtyEnv(
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

export function createPersistentCodexCliSession(
  dependencies: {
    nodePtyModule?: NodePtyModule;
    shell?: { file: string; args: string[] };
    env?: Record<string, string | undefined>;
  } = {},
): PersistentCodexCliSession {
  const nodePty = dependencies.nodePtyModule ?? loadNodePtyModule();
  const shell = dependencies.shell ?? getPreferredShell();
  const terminal = nodePty.spawn(shell.file, shell.args, {
    name: "xterm-color",
    cwd: process.cwd(),
    env: buildPtyEnv(dependencies.env ?? process.env),
    cols: 120,
    rows: 40,
  });
  let outputBuffer = "";
  let commandQueue = Promise.resolve();
  let currentRequest: ActivePtyRequest | null = null;
  let currentCommandCwd = process.cwd();
  let currentSessionId: string | undefined;
  // 这份队列专门接住“上一轮 turn 已结束，但下一轮 execute 尚未启动”窗口里的输入，
  // 防止 Workflow 已确认透传后又因为接收窗口切换而丢失。
  const pendingInputs: string[] = [];
  let disposed = false;
  let failedError: Error | undefined;
  const readyMarker = "__AEGISFLOW_PTY_READY__";
  let resolveReadyPromise: (() => void) | undefined;
  let rejectReadyPromise: ((error: Error) => void) | undefined;
  let readyState: "pending" | "ready" | "failed" = "pending";
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReadyPromise = () => {
      if (readyState !== "pending") {
        return;
      }

      readyState = "ready";
      resolve();
    };
    rejectReadyPromise = (error: Error) => {
      if (readyState !== "pending") {
        return;
      }

      readyState = "failed";
      reject(error);
    };
  });
  // readyPromise 可能在真正 await 之前就因为 PTY 异常退出而 reject。
  // 这里先吞掉未处理拒绝告警，真实错误仍会在后续 await readyPromise 时抛出。
  void readyPromise.catch(() => undefined);
  const failSession = (error: Error): void => {
    // failedError 一旦写入，表示这个 role terminal 已经永久不可用。
    // 后续 execute/sendInput 都必须直接失败，不能继续把它当成可恢复的空闲会话。
    failedError ??= error;
    rejectReadyPromise?.(failedError);

    if (currentRequest) {
      // PTY 一旦进入失败态，当前正在执行的 turn 也必须同步失败，
      // 否则上层会误以为 role 仍可继续产出结果。
      const activeRequest = currentRequest;
      currentRequest = null;
      activeRequest.reject(failedError);
    }
  };
  const assertSessionAvailable = (): void => {
    // 这里集中收口 session 可用性判断，避免 execute/sendInput/shutdown
    // 各自维护一套不一致的“是否还能继续使用这个 PTY”的逻辑。
    if (disposed) {
      throw new Error("codex PTY session has been disposed");
    }

    if (failedError) {
      throw failedError;
    }
  };

  const readyPromiseSettled = () => readyState !== "pending";

  const formatPtyExitError = (event?: { exitCode: number; signal?: number }): Error => {
    if (event?.signal !== undefined) {
      return new Error(`codex PTY session exited unexpectedly (signal=${String(event.signal)})`);
    }

    if (event?.exitCode !== undefined) {
      return new Error(`codex PTY session exited unexpectedly (code=${String(event.exitCode)})`);
    }

    return new Error("codex PTY session exited unexpectedly");
  };

  const markReady = (): void => {
    resolveReadyPromise?.();
  };

  const handleIdleLine = (line: string): void => {
    if (line === readyMarker) {
      markReady();
    }
  };

  terminal.onData((chunk: string) => {
    // node-pty 给的是原始字符流，不保证按行切分。
    // 这里先把 chunk 累到 outputBuffer，再统一按换行拆成“逻辑行”做后续解析。
    outputBuffer += normalizeProcessChunk(chunk);
    outputBuffer = flushStdoutLines(outputBuffer, (line) => {
      if (currentRequest) {
        // 共享 PTY 流上的输出先按“当前 turn”解释，
        // 由 exitMarker/sessionId 解析器决定这是结束信号还是可见输出。
        routePtyLine(line, currentRequest, (sessionId) => {
          currentSessionId = sessionId;
        });
        return;
      }

      handleIdleLine(line);
    });
  });

  terminal.onExit((event) => {
    const exitError = formatPtyExitError(event);

    if (!readyPromiseSettled()) {
      // shell 在 ready marker 建立前就退出时，后续 execute 不能再一直卡在 readyPromise。
      failSession(exitError);
      return;
    }

    failedError ??= exitError;

    if (currentRequest) {
      failSession(exitError);
    }
  });

  // role 的运行时实体是长期存在的 PTY 终端；
  // 后续多个 codex turn 都在这个终端里串行执行，而不是每轮重新创建一个 role terminal。
  // `stty -echo` 是为了避免用户看见 shell 回显的命令本身；
  // `readyMarker` 则是这个 shell 首次进入“可接命令空闲态”的确认信号。
  terminal.write(`stty -echo\r`);
  terminal.write(`printf '${readyMarker}\\n'\r`);

  return {
    async executeCommand(file, args, options) {
      assertSessionAvailable();

      const nextCommand = commandQueue.catch(() => undefined).then(async () => {
        assertSessionAvailable();

        // 第一轮命令启动前，必须先确认 shell 已经就绪。
        // 否则 role terminal 看似存在，但底层 shell 可能还没真正进入可执行状态。
        await readyPromise;
        assertSessionAvailable();
        // 同一个 role terminal 可以跨多轮 turn 复用，
        // 但每轮都要先切回目标 cwd，避免 shell 上下文漂移。
        await ensurePtyWorkingDirectory(terminal, options.cwd, currentCommandCwd);
        currentCommandCwd = options.cwd;
        await runCommandInsidePty(terminal, {
          file,
          args,
          options,
          getCurrentSessionId() {
            return currentSessionId;
          },
          setCurrentRequest(request) {
            currentRequest = request;
          },
          clearCurrentRequest() {
            currentRequest = null;
          },
          takePendingInput() {
            return pendingInputs.shift();
          },
        });
      });

      commandQueue = nextCommand;
      return nextCommand;
    },
    async sendInput(input: string): Promise<InputDeliveryResult> {
      if (input.length === 0) {
        return {
          accepted: false,
          mode: "rejected",
          reason: "empty_input",
        };
      }

      if (disposed) {
        return {
          accepted: false,
          mode: "rejected",
          reason: "session_disposed",
        };
      }

      if (failedError) {
        return {
          accepted: false,
          mode: "rejected",
          reason: "session_unavailable",
        };
      }

      // 运行中补充输入不再继续写当前 codex 进程的 stdin；
      // 而是显式挂到当前 role terminal 的下一轮 resume turn，保证协议边界清晰。
      // 如果当前 turn 还在执行，就先挂到 currentRequest；
      // 如果当前 turn 已结束但 executeCommand 还没把下一轮启动起来，就先落到 pendingInputs。
      if (currentRequest) {
        currentRequest.pendingInputs.push(input);
      } else {
        pendingInputs.push(input);
      }

      return {
        accepted: true,
        mode: "queued",
      };
    },
    async shutdown() {
      disposed = true;
      failSession(new Error("codex PTY session has been disposed"));
      try {
        terminal.kill();
      } catch {
        // Intake 结束时以尽力清理为主。
      }
      await commandQueue.catch(() => undefined);
    },
  };
}

function loadNodePtyModule(): NodePtyModule {
  try {
    return require("node-pty") as NodePtyModule;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown node-pty load error";

    throw new Error(`node-pty is required before starting role PTY sessions: ${message}`);
  }
}

async function ensurePtyWorkingDirectory(
  terminal: NodePtyTerminal,
  targetCwd: string,
  currentCwd: string,
): Promise<void> {
  if (targetCwd === currentCwd) {
    return;
  }

  terminal.write(`cd ${escapeShellArg(targetCwd)}\r`);
}

async function runCommandInsidePty(
  terminal: NodePtyTerminal,
  input: {
    file: string;
    args: string[];
    options: {
      cwd: string;
      input: string;
      env: Record<string, string | undefined>;
      timeoutMs: number;
      onStdoutLine?: (line: string) => void;
      buildFollowUpArgs?: (
        input: string,
        sessionId?: string,
      ) => string[];
    };
    getCurrentSessionId: () => string | undefined;
    setCurrentRequest: (request: ActivePtyRequest) => void;
    clearCurrentRequest: () => void;
    takePendingInput: () => string | undefined;
  },
): Promise<void> {
  const request: ActivePtyRequest = {
    exitMarker: "",
    pendingInputs: [],
    onStdoutLine: input.options.onStdoutLine,
    resolve() {
      return;
    },
    reject() {
      return;
    },
  };
  let commandArgs = input.args;
  // currentRequest 只覆盖这一次 executeCommand 链路。
  // live input 如果命中这个窗口，会先进入 request.pendingInputs，再被转换成下一轮 resume turn。
  input.setCurrentRequest(request);

  try {
    while (true) {
      // 这里的 while 不是“重复执行同一条命令”，
      // 而是把“首轮 execute + 若干轮运行中补充输入触发的 resume turn”串成一个完整执行链。
      await runSinglePtyCommand(terminal, {
        file: input.file,
        args: commandArgs,
        timeoutMs: input.options.timeoutMs,
        env: input.options.env,
        request,
      });

      const pendingInput =
        request.pendingInputs.shift() ?? input.takePendingInput();

      if (!pendingInput) {
        // 没有新的运行中输入时，这一整次 executeCommand 链路才算真正结束。
        return;
      }

      const followUpArgs = input.options.buildFollowUpArgs?.(
        pendingInput,
        input.getCurrentSessionId(),
      );

      if (!followUpArgs) {
        return;
      }

      // 运行中补充输入会在同一个 role PTY terminal 里显式追加成下一轮 resume turn，
      // 不再与当前 turn 共用同一条 stdin 流。
      commandArgs = followUpArgs;
    }
  } finally {
    // turn 链路结束后必须清理 currentRequest，
    // 否则 idle 输出会被误判成仍属于旧 turn。
    input.clearCurrentRequest();
  }
}

async function runSinglePtyCommand(
  terminal: NodePtyTerminal,
  input: {
    file: string;
    args: string[];
    timeoutMs: number;
    env: Record<string, string | undefined>;
    request: ActivePtyRequest;
  },
): Promise<void> {
  const exitMarker = `__AEGISFLOW_ROLE_EXIT_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}__`;

  await new Promise<void>((resolve, reject) => {
    // timeout 只覆盖“这一轮 codex turn”，而不是整个 role terminal 的生命周期。
    // terminal 本身可以继续存活，后续是否还能复用由上层 failSession / shutdown 决定。
    const timeoutHandle = setTimeout(() => {
      reject(new Error(`codex exited with timeout after ${input.timeoutMs}ms`));
    }, input.timeoutMs);

    // 同一个 request 对象会跨多轮 turn 复用，
    // 但每轮都必须换一个新的 exitMarker，避免旧 turn 的尾部输出误命中新 turn。
    input.request.exitMarker = exitMarker;
    input.request.resolve = () => {
      clearTimeout(timeoutHandle);
      resolve();
    };
    input.request.reject = (error: Error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    };

    // shell 真正执行的是“codex 子命令 + 唯一 exitMarker 打点”。
    // 这样 routePtyLine() 才能在共享 PTY 流里识别某一轮 turn 的结束位置。
    terminal.write(
      buildPtyCommandLine(input.file, input.args, input.env, exitMarker),
    );
  });
}

function buildPtyCommandLine(
  file: string,
  args: string[],
  env: Record<string, string | undefined>,
  exitMarker: string,
): string {
  const envPrefix = buildShellEnvPrefix(env);
  const command = [
    envPrefix,
    escapeShellArg(file),
    ...args.map(escapeShellArg),
  ]
    .filter((segment) => segment.length > 0)
    .join(" ");

  // 这里交给 shell 的不是单纯一个 codex 命令，而是：
  // 1. 带环境前缀的 codex 子命令
  // 2. codex 退出后立即打印 exitMarker:exitCode
  // 后面 routePtyLine() 看到这个标记，才知道这一轮 turn 已经结束。
  return `${command} ; printf '${exitMarker}:%s\\n' "$?"\r`;
}

function routePtyLine(
  line: string,
  request: ActivePtyRequest,
  onSessionId?: (sessionId: string) => void,
): void {
  // Codex JSONL 事件和 shell 自己的 exitMarker 会混在同一条 PTY 输出流里。
  // 这里统一做两件事：提取 thread/session id，以及识别本轮 turn 的结束信号。
  const discoveredSessionId = extractSessionIdFromCodexEventLine(line);

  if (discoveredSessionId) {
    onSessionId?.(discoveredSessionId);
  }

  if (line.startsWith(`${request.exitMarker}:`)) {
    const exitCode = Number(line.slice(request.exitMarker.length + 1));

    if (!Number.isFinite(exitCode) || exitCode !== 0) {
      // shell 负责打印 exit code，但业务上要把它转成当前 turn 的 reject，
      // 这样 executeCommand 才会把本轮 codex 失败正确传播给 Workflow。
      request.reject(new Error(`codex exited with code ${String(exitCode)}`));
      return;
    }

    request.resolve();
    return;
  }

  request.onStdoutLine?.(line);
}

function getPreferredShell(): { file: string; args: string[] } {
  const shell = process.env.SHELL?.trim();

  if (shell) {
    return {
      file: shell,
      args: [],
    };
  }

  return {
    file: "/bin/sh",
    args: [],
  };
}

function buildShellEnvPrefix(env: Record<string, string | undefined>): string {
  return Object.entries(env)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${escapeShellArg(value ?? "")}`)
    .join(" ");
}

function escapeShellArg(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildCodexCommandArgs(
  input: RoleAgentExecutionRequest,
  outputPath: string,
  sessionId?: string,
): string[] {
  const configOverrides = buildCodexConfigOverrides(input.config);
  const baseArgs = sessionId
    ? [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        ...configOverrides,
        "--output-last-message",
        outputPath,
        sessionId,
        input.prompt,
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
        ...configOverrides,
        "--output-last-message",
        outputPath,
        input.prompt,
      ];

  return baseArgs;
}

function buildCodexParticipationCommandArgs(
  outputPath: string,
  config: RoleCodexConfig,
  prompt: string,
  sessionId?: string,
): string[] {
  const configOverrides = buildCodexConfigOverrides(config);

  return sessionId
    ? [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        ...configOverrides,
        "--output-last-message",
        outputPath,
        sessionId,
        prompt,
      ]
    : [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "--last",
        ...configOverrides,
        "--output-last-message",
        outputPath,
        prompt,
      ];
}

function buildCodexConfigOverrides(config: RoleCodexConfig): string[] {
  return [
    "-c",
    `openai_base_url=${JSON.stringify(config.baseUrl)}`,
  ];
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
    // base url 已经通过 codex config override 传入，不能再走已弃用的 OPENAI_BASE_URL。
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

function normalizeVisibleText(value: string): string {
  // Codex CLI 已经给出了可直接展示的文本片段，
  // 这里不再做 trim、换行修复或空白折叠，避免破坏原始格式边界。
  return value;
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string;
      cwd?: string;
      env?: Record<string, string>;
      cols?: number;
      rows?: number;
    },
  ): NodePtyTerminal;
}

interface NodePtyTerminal {
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  kill(): void;
}

interface PersistentCodexCliSession {
  executeCommand(
    file: string,
    args: string[],
    options: {
      cwd: string;
      input: string;
      env: Record<string, string | undefined>;
      timeoutMs: number;
      onStdoutLine?: (line: string) => void;
      buildFollowUpArgs?: (
        input: string,
        sessionId?: string,
      ) => string[];
    },
  ): Promise<void>;
  sendInput(input: string): Promise<InputDeliveryResult>;
  shutdown(): Promise<void>;
}

interface ActivePtyRequest {
  exitMarker: string;
  pendingInputs: string[];
  onStdoutLine?: (line: string) => void;
  resolve: () => void;
  reject: (error: Error) => void;
}

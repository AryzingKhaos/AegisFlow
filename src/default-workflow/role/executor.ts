import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ExecutionContext,
  RoleCapabilityProfile,
  RoleName,
  TaskDebugEvent,
} from "../shared/types";
import type { RoleCodexConfig } from "./config";

// 同一进程内连续执行 role 时，为输出文件名追加递增序号，
// 避免同毫秒时间戳下出现路径冲突。
let executionSequence = 0;
declare const require: (id: string) => unknown;
declare function setTimeout(
  handler: (...args: unknown[]) => void,
  timeout?: number,
): unknown;
declare function clearTimeout(handle: unknown): void;

interface SpawnedProcess {
  // 这里故意只声明本文件真实会用到的 child_process 能力，
  // 避免把完整 Node 类型面引进来，降低跨环境耦合。
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
  // 哪个 role 在执行，决定 prompt、能力边界和产物语义。
  roleName: RoleName;
  // 已经在上游拼好的最终 prompt 文本。
  prompt: string;
  // Workflow 为本次执行构建的上下文快照。
  context: ExecutionContext;
  // 当前 role 的执行权限边界，例如是否允许副作用。
  executionProfile: RoleCapabilityProfile;
  // provider 级别的模型与 API 配置。
  config: RoleCodexConfig;
}

export interface RoleAgentExecutor {
  readonly executorKind: string;
  execute(input: RoleAgentExecutionRequest): Promise<string>;
  shutdown?(): Promise<void>;
}

export interface TransportExecutionRequest {
  // Transport 只负责“怎么跑起来”，不关心 role 结果格式。
  command: string;
  args: string[];
  // 命令实际运行目录，由项目配置统一提供。
  cwd: string;
  // 传给子进程 stdin 的原始文本。
  stdin: string;
  env: Record<string, string | undefined>;
  // Transport 自己负责超时 kill 与错误包装。
  timeoutMs: number;
  // stdout 在这里按“行”回调，方便 UI/日志按文本流消费。
  onStdoutLine?: (line: string) => void | Promise<void>;
  // stderr 保持 chunk 粒度，尽量不破坏底层输出边界。
  onStderrChunk?: (chunk: string) => void | Promise<void>;
  // onExit 只表达“进程已 close”的事实，不代表一定成功。
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
  // Provider 负责把 role 请求翻译成某个具体 CLI/provider 的调用方式。
  command: string;
  args: string[];
  cwd: string;
  // 某些 provider 可能需要把 prompt 或控制命令通过 stdin 发送。
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
  // 如果 provider 自己还维护了异步输出链路，调用方需要显式等它 drain。
  flushVisibleOutput?(): Promise<void>;
  // 统一从 provider 读取“最终结果载荷”，而不是假定它一定来自 stdout。
  readResult(): Promise<string>;
}

export interface CliProvider {
  readonly providerKind: string;
  prepareExecution(input: RoleAgentExecutionRequest): Promise<ProviderExecutionRequest>;
}

export interface ChildProcessTransportDependencies {
  // 测试时可替换成 fake transport；生产默认留空走真实实现。
  runProcess?: (request: TransportExecutionRequest) => Promise<void>;
}

export interface CodexCliExecutorDependencies {
  // 兼容用例里直接替换 codex 命令执行，不要求真的启动 codex。
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

  // 执行一条 transport 请求，优先使用注入的运行实现，否则走默认 child_process。
  public async execute(request: TransportExecutionRequest): Promise<void> {
    if (this.dependencies.runProcess) {
      // 测试或特定宿主可以注入自己的运行实现；
      // 默认实现仍走真实 child_process。
      await this.dependencies.runProcess(request);
      return;
    }

    // 真实 transport 的唯一职责是把 request 生命周期完整跑完。
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

  // 把 role 执行请求翻译成一条 codex exec 调用，并准备结果读取与可见输出钩子。
  public async prepareExecution(
    input: RoleAgentExecutionRequest,
  ): Promise<ProviderExecutionRequest> {
    // outputPath 不进正式 artifact 体系，
    // 只是 provider 和 executor 之间交换最终消息的临时文件。
    const outputPath =
      this.dependencies.buildOutputPath?.(input) ?? buildRoleAgentOutputPath(input);

    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // pendingVisibleOutput 始终指向“当前最后一条可见输出完成时”的 Promise。
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
      // 可见输出是异步串行刷到宿主 UI 的；
      // execute() 返回前需要显式等待，避免“角色已结束但最后几行还没显示”。
      flushVisibleOutput: async () => pendingVisibleOutput,
      // Codex CLI 的最终结果不一定来自 stdout，
      // 而是通过 --output-last-message 输出到文件后再读取。
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

  // 执行一次 role 调用，补齐 stdout/stderr/exit/result 的统一调试记录，并返回最终结果字符串。
  public async execute(input: RoleAgentExecutionRequest): Promise<string> {
    try {
      // 先让 provider 决定“怎么调用 CLI”，再在此基础上叠加统一的调试/可见输出语义。
      const request = await this.provider.prepareExecution(input);
      const instrumentedRequest: ProviderExecutionRequest = {
        ...request,
        // stdout 一方面用于 UI 可见输出，一方面也要保真写入 task 级调试事件。
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
          // 先透传原始 hook，再记调试事件，保持调用方观察到的顺序稳定。
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
          // exit 事件要等调用方 hook 完成后再记账，
          // 否则磁盘调试事件和宿主行为容易出现乱序。
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

      await emitExecutionDebugEvent(input.context, {
        type: "executor_prompt",
        source: "executor",
        phase: input.context.phase,
        roleName: input.roleName,
        message: "executor received final prompt",
        payload: input.prompt,
        metadata: {
          command: request.command,
          args: request.args,
          cwd: request.cwd,
        },
      });
      // transport 负责真正运行命令，并保证 stdout/stderr/exit 的异步 hook 已完成。
      await this.transport.execute(instrumentedRequest);
      // UI 可见输出和底层执行完成是两条异步链，需要单独等待。
      await instrumentedRequest.flushVisibleOutput?.();
      // 这里读取的是 provider 约定的最终消息，不等同于“最后一条 stdout”。
      const result = await instrumentedRequest.readResult();
      // 最终原始 payload 单独落调试事件，
      // 避免“stdout 很完整，但真正结果文件内容丢失”。
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

      // execute() 对外统一包装 executor 错误，
      // 但原始错误文本仍保存在 metadata.rawError 中供排障使用。
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

// 创建默认的 role executor，使用 child_process transport 和 codex provider 组合。
export function createRoleAgentExecutor(): RoleAgentExecutor {
  return new DefaultRoleAgentExecutor();
}

export class CodexCliRoleAgentExecutor extends DefaultRoleAgentExecutor {
  // 创建一个面向 Codex CLI 的 executor，并允许测试或宿主替换底层命令执行器。
  public constructor(
    dependencies: CodexCliExecutorDependencies = {},
  ) {
    super({
      transport: new ChildProcessCliTransport({
        runProcess: async (request) => {
          if (dependencies.runCommand) {
            // 这里主要给测试或上层宿主注入替代执行器；
            // 默认生产路径仍然走 runChildProcess。
            await dependencies.runCommand(request.command, request.args, {
              cwd: request.cwd,
              input: request.stdin,
              env: request.env,
              timeoutMs: request.timeoutMs,
              onStdoutLine: request.onStdoutLine,
            });
            return;
          }

          // 没有注入替代实现时，直接用本文件的 child_process transport。
          await runChildProcess(request);
        },
      }),
      provider: new CodexCliProvider(),
    });
  }
}

// 为单次 role 执行生成临时输出文件路径，用于接收 provider 写出的最终消息。
export function buildRoleAgentOutputPath(
  input: Pick<RoleAgentExecutionRequest, "roleName" | "context">,
): string {
  const sequence = executionSequence++;
  const randomSuffix = Math.random().toString(36).slice(2, 10);

  // 输出文件放在 runtime-cache 下，既避免污染任务正式工件目录，
  // 也方便 provider 以“写文件 -> readResult()”的方式返回结果。
  // 文件名里同时带 taskId/phase/roleName/时间戳/序号/随机后缀，
  // 这样即便同一任务高频调用也很难冲突。
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

// 清洗路径片段，避免 taskId/phase/roleName 中的特殊字符进入文件名。
function sanitizeCacheSegment(value: string): string {
  // 只保留适合文件名的安全字符，避免 phase/taskId 中的特殊字符污染路径。
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

// 用真实 child_process 执行命令，并把 stdout/stderr/exit/error 转成可等待的异步回调链。
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
    // stdoutBuffer 只缓存尚未形成完整一行的尾部内容。
    let stdoutBuffer = "";
    // stderrBuffer 保留全量 stderr，供最终错误包装或 onExit 诊断使用。
    let stderrBuffer = "";
    let timeoutReached = false;
    let settled = false;
    // 所有异步 hook 都串到同一条队列上，
    // 这样 stdout/stderr/exit/debug 落盘顺序才能和真实到达顺序一致。
    let callbackQueue = Promise.resolve();
    const timer = setTimeout(() => {
      timeoutReached = true;
      child.kill("SIGKILL");
    }, request.timeoutMs);

    const settleResolve = (): void => {
      // resolve/reject 只能发生一次；后续晚到的事件直接忽略。
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
      // 即使某个回调失败，也不能让后续 queue 永久断链；
      // callbackQueue 存的是“吞掉 rejection 后的尾指针”。
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
      // 这里不直接 await，是因为事件回调来自 EventEmitter；
      // 用串行队列托管，再由 onSuccess/settleReject 收口 Promise 生命周期。
      void enqueueCallback(operation).then(
        () => {
          options.onSuccess?.();
        },
        (error) => {
          if (options.killOnError) {
            // stdout/stderr hook 自身抛错时，继续让子进程跑只会放大乱序和重复错误。
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

      // Node 的 data 事件 chunk 可能是 Buffer、string，甚至任意可 toString 对象。
      const normalizedChunk = normalizeProcessChunk(chunk);
      observeCallback(
        async () => {
          // stdout 需要按“行”分发给上层；
          // 未形成完整一行的尾部内容先缓存在 stdoutBuffer 中。
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
          // stderr 保留原始 chunk 粒度，
          // 避免强行按行切分后丢掉底层输出的真实边界。
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
        // transport error 属于“命令根本没正常跑起来”这一层，
        // 和进程正常 close 后的非零退出是不同语义。
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
          // close 到来时，stdout 里可能还留着最后一段没有换行的文本。
          const stdoutRemainder =
            stdoutBuffer.length > 0 ? stdoutBuffer.replace(/\r$/, "") : undefined;

          if (stdoutRemainder) {
            // close 前最后一段没有换行的 stdout 也要补发出去，
            // 否则尾行会在成功路径里静默丢失。
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
            // timeout 语义优先级高于 exit code；
            // 即使 close 时 code 也有值，外部也应看到超时错误。
            throw new Error(`command timed out after ${String(request.timeoutMs)}ms`);
          }

          if (code !== 0) {
            // 非零退出优先带 stderr，避免错误信息退化成单纯的 exit code。
            const failureReason =
              stderrBuffer.trim() || `process exited with code ${String(code)}`;
            throw new Error(
              signal ? `${failureReason} (signal: ${signal})` : failureReason,
            );
          }
        },
        {
          onSuccess: () => {
            // 只有在 close 相关所有异步 hook 都成功完成后，才算 transport 真正结束。
            settleResolve();
          },
        },
      );
    });

    if (request.stdin.length > 0) {
      // 当前 Codex CLI 主要靠命令行参数传 prompt，
      // 但保留 stdin 通道，兼容未来 provider 或测试注入场景。
      child.stdin.write(request.stdin);
    }

    child.stdin.end();
  });
}

// 从 stdout 缓冲区中切出完整行并依次回调，返回最后未形成完整一行的残留内容。
async function flushStdoutLines(
  buffer: string,
  onStdoutLine?: (line: string) => void | Promise<void>,
): Promise<string> {
  let cursor = buffer.indexOf("\n");
  let remaining = buffer;

  while (cursor >= 0) {
    // 去掉 CR，兼容 Windows 风格换行。
    const line = remaining.slice(0, cursor).replace(/\r$/, "");
    // 这里串行 await，保证上层 onStdoutLine 的异步副作用不会彼此穿插。
    await onStdoutLine?.(line);
    remaining = remaining.slice(cursor + 1);
    cursor = remaining.indexOf("\n");
  }

  // 返回末尾未形成完整一行的残留片段，继续交给调用方缓存。
  return remaining;
}

// 统一把 child_process data 事件里的任意 chunk 转成字符串。
function normalizeProcessChunk(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (chunk && typeof chunk === "object" && "toString" in chunk) {
    // Buffer 也会走这里，最终统一转成普通字符串。
    return String((chunk as { toString: () => string }).toString());
  }

  return String(chunk ?? "");
}

// 过滤掉 undefined 环境变量，生成可直接传给 spawn 的环境对象。
function buildSpawnEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const nextEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      // spawn 的 env 只接受确定值；undefined 表示显式不透传。
      continue;
    }

    nextEnv[key] = value;
  }

  // spawn 只吃确定的 string 值，所以这里的返回类型是 Record<string, string>。
  return nextEnv;
}

// 把 codex stdout 中可见的文本消息串行转发给宿主 UI。
function visibleLineEmitter(
  emitVisibleOutput: NonNullable<ExecutionContext["emitVisibleOutput"]>,
  setPendingOutput: (value: Promise<void>) => void,
  getPendingOutput: () => Promise<void>,
): (line: string) => void {
  return (line: string) => {
    // Codex 的 JSON event 里可能有多处可见文本，
    // 先抽取成普通消息，再串行推给宿主 UI。
    const visibleMessages = extractVisibleMessagesFromCodexEventLine(line);

    for (const message of visibleMessages) {
      // 每条消息都链接到“上一条完成之后”再发出，
      // 避免终端 UI 因并发 setState 出现顺序颠倒。
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

// 把两个 stdout 处理器串成一个顺序执行的处理器，先调主处理器，再做补充处理。
function chainStdoutHandlers(
  primary: ((line: string) => void | Promise<void>) | undefined,
  secondary: (line: string) => Promise<void>,
): (line: string) => Promise<void> {
  return async (line: string) => {
    // primary 一般是 UI 可见输出，secondary 一般是调试事件；
    // 顺序固定为“先给调用方，再做内部记账”。
    await primary?.(line);
    await secondary(line);
  };
}

// 把任意 unknown 错误归一成 Error 对象，方便外层统一包装和上报。
function normalizeUnknownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  // 外层错误通道统一使用 Error，避免后续包装逻辑分支过多。
  return new Error(String(error ?? "unknown child process error"));
}

// 通过 execution context 发出一条 task 级调试事件。
async function emitExecutionDebugEvent(
  context: ExecutionContext,
  event: Omit<TaskDebugEvent, "taskId" | "timestamp"> & {
    timestamp?: number;
  },
): Promise<void> {
  // executor 自己不持有 taskId，统一借用 execution context 的调试出口。
  // 如果当前上下文未提供 emitDebugEvent，这里会安全降级成 no-op。
  await context.emitDebugEvent?.({
    ...event,
    timestamp: event.timestamp ?? Date.now(),
  });
}

// 组装 codex exec 的命令行参数。
function buildCodexCommandArgs(
  input: RoleAgentExecutionRequest,
  outputPath: string,
): string[] {
  // 这里固定使用 one-shot `codex exec`；
  // 不依赖跨轮 session / resume 语义来维持上下文。
  return [
    "exec",
    "--json",
    // full-auto 让 Codex 在其权限边界内自主执行工具调用。
    "--full-auto",
    // 当前 workflow 允许在非 git 仓库目录下运行，不强制要求项目本身是仓库。
    "--skip-git-repo-check",
    "--sandbox",
    // sideEffects=allowed 的 role 才允许 workspace-write；
    // 其余分析型角色默认只读。
    input.executionProfile.sideEffects === "allowed"
      ? "workspace-write"
      : "read-only",
    "--cd",
    input.context.projectConfig.roleExecutor.transport.cwd,
    "--model",
    input.config.model,
    // 目前只覆盖 base url；其他 provider 配置继续走环境变量。
    ...buildCodexConfigOverrides(input.config),
    "--output-last-message",
    outputPath,
    input.prompt,
  ];
}

// 生成传给 codex 的配置覆盖参数，目前只覆盖 base url。
function buildCodexConfigOverrides(config: RoleCodexConfig): string[] {
  // JSON.stringify 用来正确转义 URL，避免引号或特殊字符破坏 `-c key=value` 语法。
  return ["-c", `openai_base_url=${JSON.stringify(config.baseUrl)}`];
}

// 构建本次 executor 调用的环境变量集合。
function buildExecutorEnv(
  input: RoleAgentExecutionRequest,
): Record<string, string | undefined> {
  const passthrough =
    input.context.projectConfig.roleExecutor.transport.env.passthrough;
  // 是否继承宿主环境由项目配置控制；
  // 即使不透传，也会显式注入当前执行所需的 OPENAI_API_KEY。
  const baseEnv = passthrough ? { ...process.env } : {};

  return {
    ...baseEnv,
    OPENAI_API_KEY: input.config.apiKey,
  };
}

// 从一行 codex stdout 中提取可以展示给用户的文本消息。
function extractVisibleMessagesFromCodexEventLine(line: string): string[] {
  const trimmedLine = line.trim();

  if (line.length === 0) {
    return [];
  }

  try {
    // stdout 优先按 Codex JSON event 解析；
    // 解析失败时再退回普通文本行处理。
    const parsed = JSON.parse(trimmedLine) as Record<string, unknown>;

    return collectVisibleMessages(parsed).filter((message) => message.length > 0);
  } catch {
    // 不是 JSON 时，把它当普通文本行展示，但会先过滤已知噪音。
    return shouldSuppressPlainStdoutLine(trimmedLine) ? [] : [line];
  }
}

// 从 codex 的 JSON event 对象中收集可见文本与审批提示。
function collectVisibleMessages(payload: Record<string, unknown>): string[] {
  const eventType = typeof payload.type === "string" ? payload.type : "";
  const messages: string[] = [];
  const approvalMessages = collectApprovalRequestMessages(payload);

  pushIfPresent(messages, payload.message);
  pushIfPresent(messages, payload.delta);
  pushIfPresent(messages, payload.text);
  pushIfPresent(messages, payload.output_text);

  // Codex 事件文本可能嵌在 content/item/response 等不同字段层级里。
  collectNestedText(messages, payload.content);
  collectNestedText(messages, payload.item);
  collectNestedText(messages, payload.response);

  if (messages.length > 0) {
    // 普通文本和审批提示可以同时存在，审批提示附在尾部一起展示。
    return [...messages, ...approvalMessages];
  }

  if (approvalMessages.length > 0) {
    return approvalMessages;
  }

  return shouldSuppressJsonEvent(eventType) ? [] : [];
}

// 递归遍历任意 JSON 值，把可能的文本字段收集出来。
function collectNestedText(target: string[], value: unknown): void {
  if (typeof value === "string") {
    pushIfPresent(target, value);
    return;
  }

  if (Array.isArray(value)) {
    // content 常见形态之一是数组，逐项展开递归即可。
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
      // seen 集只在审批消息提取里需要；
      // 这里依赖 JSON event 一般是无环对象。
      if (nestedValue !== value) {
        collectNestedText(target, nestedValue);
      }
    }
  }
}

// 如果值是可展示的非空字符串，则追加到消息列表中。
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
    // 某些提示虽然出现在 message/text 字段里，但本质仍是 CLI 噪音。
    return;
  }

  target.push(normalized);
}

// 判断某个 JSON 事件类型是否应当作为协议噪音被忽略。
function shouldSuppressJsonEvent(eventType: string): boolean {
  // 这些事件更像协议噪音，直接展示给用户没有信息价值。
  return (
    eventType === "thread.started" ||
    eventType === "thread.completed" ||
    eventType === "turn.started" ||
    eventType === "turn.completed"
  );
}

// 判断某条普通 stdout 文本是否属于底层噪音而不应直接展示。
function shouldSuppressPlainStdoutLine(line: string): boolean {
  // 这些文本来自底层 CLI/运行时提示，
  // 直接展示给业务用户通常只会增加噪音。
  return (
    line.startsWith("WARNING: proceeding") ||
    line.startsWith("note: run with") ||
    line.startsWith("thread '") ||
    line.startsWith("Could not create otel exporter") ||
    /^\d{4}-\d{2}-\d{2}T/.test(line)
  );
}

// 从一个复杂事件对象里递归抽取所有需要展示的审批请求消息。
function collectApprovalRequestMessages(payload: Record<string, unknown>): string[] {
  const messages: string[] = [];

  // 审批信息可能嵌在 tool_call / item / response 深层对象里，递归搜一遍。
  collectApprovalMessagesFromValue(payload, messages, new Set<unknown>());

  // 相同审批请求在多层结构里可能被扫到多次，这里去重。
  return [...new Set(messages)];
}

// 深度遍历任意对象值，识别并收集嵌套结构里的审批请求消息。
function collectApprovalMessagesFromValue(
  value: unknown,
  target: string[],
  seen: Set<unknown>,
): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (seen.has(value)) {
    // 审批提取是全对象图递归，必须防环。
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

// 如果对象表达的是一次真正的提权请求，则格式化成可直接展示的审批提示文本。
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
    // 只有真正的提权请求才展示成“审批请求”；
    // 普通工具调用即使带 cmd/path 也不能误报。
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

  // 保持多行格式，方便 Intake/UI 原样展示给用户审批。
  return lines.join("\n");
}

// 从不同形态的 tool call 事件中解析出工具名。
function resolveApprovalToolName(record: Record<string, unknown>): string | undefined {
  // 不同 tool event 格式对名称字段命名并不统一，这里按常见字段顺序兜底。
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
    // 某些事件会把真正的 tool call 再包一层。
    return resolveApprovalToolName(toolCall as Record<string, unknown>);
  }

  return undefined;
}

// 从不同形态的 tool call 事件中解析出参数对象。
function resolveApprovalParameters(
  record: Record<string, unknown>,
): Record<string, unknown> | undefined {
  // 不同来源的 tool call 结构不统一，依次兼容 parameters / args / input。
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

// 如果某个值是普通对象，则把它视为可继续解析的审批参数记录。
function pickApprovalParameterRecord(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  // 审批参数要求是键值对象；数组等结构不纳入审批识别。
  return value as Record<string, unknown>;
}

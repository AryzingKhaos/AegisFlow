import { normalizeCliText } from "../default-workflow/intake/output";
import type { TaskStatus, WorkflowEvent } from "../default-workflow/shared/types";

export interface UiBlock {
  id: string;
  title: string;
  body: string;
  tone: "accent" | "muted" | "result" | "error";
}

export interface CliViewModel {
  appTitle: string;
  sessionTitle: string;
  currentPhase: string;
  taskStatus: string;
  inputHint: string;
  finalBlocks: UiBlock[];
  skeletonBlocks: UiBlock[];
  intermediateLines: string[];
}

export interface CliViewModelOptions {
  maxIntermediateLines?: number;
  maxSkeletonBlocks?: number;
}

const DEFAULT_OPTIONS: Required<CliViewModelOptions> = {
  maxIntermediateLines: 10,
  maxSkeletonBlocks: 8,
};

export function createInitialCliViewModel(
  bootstrapLines: string[],
): CliViewModel {
  return {
    appTitle: "AegisFlow Intake",
    sessionTitle: "未开始任务",
    currentPhase: "-",
    taskStatus: "idle",
    inputHint: buildInputHint("idle"),
    finalBlocks:
      bootstrapLines.length > 0
        ? [
            {
              id: createUiBlockId("bootstrap"),
              title: "启动信息",
              body: bootstrapLines.join("\n"),
              tone: "accent",
            },
          ]
        : [],
    skeletonBlocks: [],
    intermediateLines: [],
  };
}

export function appendSystemLines(
  viewModel: CliViewModel,
  lines: string[],
  title: string = "系统消息",
): CliViewModel {
  if (lines.length === 0) {
    return viewModel;
  }

  return {
    ...viewModel,
    finalBlocks: [
      ...viewModel.finalBlocks,
      {
        id: createUiBlockId("system"),
        title,
        body: lines.join("\n"),
        tone: "muted",
      },
    ],
  };
}

export function applyWorkflowEventToCliViewModel(
  viewModel: CliViewModel,
  event: WorkflowEvent,
  options: CliViewModelOptions = {},
): CliViewModel {
  const resolvedOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };
  const nextViewModel: CliViewModel = {
    ...viewModel,
    sessionTitle: event.taskState.title || viewModel.sessionTitle,
    currentPhase: event.taskState.currentPhase,
    taskStatus: event.taskState.status,
    inputHint: buildInputHint(event.taskState.status),
  };

  if (event.type === "role_output") {
    return routeRoleOutput(nextViewModel, event, resolvedOptions);
  }

  if (event.type === "error") {
    return {
      ...nextViewModel,
      finalBlocks: [
        ...nextViewModel.finalBlocks,
        {
          id: createUiBlockId("error"),
          title: "执行错误",
          body: buildErrorBody(event),
          tone: "error",
        },
      ],
      skeletonBlocks: appendBounded(
        nextViewModel.skeletonBlocks,
        {
          id: createUiBlockId("skeleton"),
          title: "错误事件",
          body: normalizeCliText(event.message),
          tone: "muted",
        },
        resolvedOptions.maxSkeletonBlocks,
      ),
    };
  }

  return {
    ...nextViewModel,
    skeletonBlocks: appendBounded(
      nextViewModel.skeletonBlocks,
      {
        id: createUiBlockId("skeleton"),
        title: buildSkeletonTitle(event),
        body: normalizeCliText(event.message),
        tone: "muted",
      },
      resolvedOptions.maxSkeletonBlocks,
    ),
  };
}

function routeRoleOutput(
  viewModel: CliViewModel,
  event: WorkflowEvent,
  options: Required<CliViewModelOptions>,
): CliViewModel {
  const outputKind =
    typeof event.metadata?.outputKind === "string"
      ? event.metadata.outputKind
      : "progress";

  if (outputKind === "progress") {
    return {
      ...viewModel,
      intermediateLines: appendBounded(
        viewModel.intermediateLines,
        normalizeCliText(event.message),
        options.maxIntermediateLines,
      ),
    };
  }

  return {
    ...viewModel,
    finalBlocks: [
      ...viewModel.finalBlocks,
      {
        id: createUiBlockId("result"),
        title: buildResultTitle(event, outputKind),
        body: event.message,
        tone: "result",
      },
    ],
  };
}

function appendBounded<T>(items: T[], item: T, maxSize: number): T[] {
  const nextItems = [...items, item];

  return nextItems.slice(Math.max(0, nextItems.length - maxSize));
}

function buildSkeletonTitle(event: WorkflowEvent): string {
  switch (event.type) {
    case "task_start":
      return "任务开始";
    case "task_end":
      return "任务结束";
    case "phase_start":
      return "阶段开始";
    case "phase_end":
      return "阶段结束";
    case "role_start":
      return "角色开始";
    case "role_end":
      return "角色结束";
    case "artifact_created":
      return "工件创建";
    case "progress":
      return "进度";
    default:
      return event.type;
  }
}

function buildResultTitle(event: WorkflowEvent, outputKind: string): string {
  const roleName =
    typeof event.metadata?.roleName === "string"
      ? event.metadata.roleName
      : "role";
  const phase =
    typeof event.metadata?.phase === "string"
      ? event.metadata.phase
      : event.taskState.currentPhase;

  return `${roleName} @ ${phase} · ${outputKind}`;
}

function buildErrorBody(event: WorkflowEvent): string {
  const errorDetail =
    typeof event.metadata?.error === "string"
      ? normalizeCliText(event.metadata.error)
      : "";

  if (!errorDetail) {
    return normalizeCliText(event.message);
  }

  return [normalizeCliText(event.message), "", errorDetail].join("\n");
}

function buildInputHint(status: TaskStatus | string): string {
  switch (status) {
    case "running":
      return "输入补充信息或控制命令";
    case "waiting_user_input":
      return "输入补充信息";
    case "waiting_approval":
      return "输入审批意见或继续命令";
    case "interrupted":
      return "输入恢复命令或补充信息";
    case "failed":
      return "任务已失败，可输入恢复或重新发起需求";
    case "completed":
      return "任务已完成，可继续输入新需求";
    default:
      return "输入需求或任务控制指令";
  }
}

function createUiBlockId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

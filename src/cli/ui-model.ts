import {
  createIntakeErrorViewFromWorkflowEvent,
  type IntakeErrorView,
} from "../default-workflow/intake/error-view";
import { normalizeCliText } from "../default-workflow/intake/text";
import type { TaskStatus, WorkflowEvent } from "../default-workflow/shared/types";

export interface UiBlock {
  id: string;
  order: number;
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
  currentError?: IntakeErrorView;
  nextBlockOrder: number;
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
    currentError: undefined,
    nextBlockOrder: bootstrapLines.length > 0 ? 1 : 0,
    finalBlocks:
      bootstrapLines.length > 0
        ? [
            {
              id: createUiBlockId("bootstrap"),
              order: 0,
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

  const systemBlock = createUiBlock(viewModel, "system", {
    title,
    body: lines.join("\n"),
    tone: "muted",
  });

  return {
    ...viewModel,
    nextBlockOrder: systemBlock.nextBlockOrder,
    finalBlocks: [
      ...viewModel.finalBlocks,
      systemBlock.block,
    ],
  };
}

export function appendIntakeError(
  viewModel: CliViewModel,
  error: IntakeErrorView,
): CliViewModel {
  return {
    ...viewModel,
    currentError: error,
  };
}

export function clearCliError(viewModel: CliViewModel): CliViewModel {
  if (!viewModel.currentError) {
    return viewModel;
  }

  return {
    ...viewModel,
    currentError: undefined,
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
    currentError:
      event.type !== "error" && event.taskState.status !== "failed"
        ? undefined
        : viewModel.currentError,
  };

  if (event.type === "role_output") {
    return routeRoleOutput(nextViewModel, event, resolvedOptions);
  }

  if (event.type === "error") {
    const errorSkeletonBlock = createUiBlock(nextViewModel, "skeleton", {
      title: "错误事件",
      body: normalizeCliText(event.message),
      tone: "muted",
    });

    return {
      ...nextViewModel,
      currentError: createIntakeErrorViewFromWorkflowEvent(event),
      nextBlockOrder: errorSkeletonBlock.nextBlockOrder,
      skeletonBlocks: appendBounded(
        nextViewModel.skeletonBlocks,
        errorSkeletonBlock.block,
        resolvedOptions.maxSkeletonBlocks,
      ),
    };
  }

  const skeletonBlock = createUiBlock(nextViewModel, "skeleton", {
    title: buildSkeletonTitle(event),
    body: normalizeCliText(event.message),
    tone: "muted",
  });

  return {
    ...nextViewModel,
    nextBlockOrder: skeletonBlock.nextBlockOrder,
    skeletonBlocks: appendBounded(
      nextViewModel.skeletonBlocks,
      skeletonBlock.block,
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

  const resultBlock = createUiBlock(viewModel, "result", {
    title: buildResultTitle(event, outputKind),
    body: event.message,
    tone: "result",
  });

  return {
    ...viewModel,
    nextBlockOrder: resultBlock.nextBlockOrder,
    finalBlocks: [
      ...viewModel.finalBlocks,
      resultBlock.block,
    ],
  };
}

function createUiBlock(
  viewModel: CliViewModel,
  prefix: string,
  input: Pick<UiBlock, "title" | "body" | "tone">,
): {
  block: UiBlock;
  nextBlockOrder: number;
} {
  return {
    block: {
      id: createUiBlockId(prefix),
      order: viewModel.nextBlockOrder,
      ...input,
    },
    nextBlockOrder: viewModel.nextBlockOrder + 1,
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

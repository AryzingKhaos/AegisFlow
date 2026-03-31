import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_ARTIFACT_DIR_NAME,
  INTAKE_RESUME_INDEX_FILE,
  INTAKE_STATE_DIR_NAME,
  OUT_OF_SCOPE_REPLY,
  SUPPORTED_WORKFLOW_TYPES,
} from "../shared/constants";
import {
  buildRuntimeForNewTask,
  buildRuntimeForResume,
  findLatestPersistedTask,
  loadPersistedTaskById,
} from "../runtime/builder";
import {
  createDefaultWorkflowPhases,
  createWorkflowSelection,
  formatWorkflowPhases,
  isFalsyAnswer,
  isTruthyAnswer,
  resolveArtifactDir,
} from "../shared/utils";
import type {
  IntakeEvent,
  IntakeEventType,
  PersistedTaskContext,
  Runtime,
  WorkflowPhaseConfig,
  WorkflowEvent,
  WorkflowTaskType,
} from "../shared/types";
import { TaskStatus } from "../shared/types";
import {
  describeWorkflowGuess,
  inferWorkflowTaskType,
  normalizeUserIntent,
} from "./intent";
import { initializeIntakeModel } from "./model";
import { formatWorkflowEventForCli } from "./output";

type PendingStep =
  | "confirm_workflow"
  | "confirm_workflow_profile"
  | "select_workflow"
  | "collect_project_dir"
  | "collect_artifact_dir";

interface DraftTask {
  description: string;
  workflow?: ReturnType<typeof createWorkflowSelection>;
  workflowPhases?: WorkflowPhaseConfig[];
  projectDir?: string;
  artifactDir?: string;
}

interface ResumeIndexSnapshot {
  taskId: string;
  artifactDir: string;
  updatedAt: number;
}

interface IntakeAgentOptions {
  onWorkflowOutput?: (lines: string[]) => void;
}

export class IntakeAgent {
  private runtime?: Runtime;
  private persistedContext?: PersistedTaskContext;
  private draft?: DraftTask;
  private pendingStep?: PendingStep;
  private workflowOutputBuffer: string[] = [];
  private readonly modelBootstrap = initializeIntakeModel();

  public constructor(
    private readonly cwd: string = process.cwd(),
    private readonly options: IntakeAgentOptions = {},
  ) {}

  public getBootstrapLines(): string[] {
    return [
      "AegisFlow Intake CLI 已启动。",
      `模型初始化完成：${this.modelBootstrap.config.model} @ ${this.modelBootstrap.config.baseUrl}`,
      `支持任务类型：${Object.values(SUPPORTED_WORKFLOW_TYPES)
        .map((definition) => definition.label)
        .join(" / ")}`,
      "直接输入自然语言需求即可开始；如需恢复未完成任务，可输入“恢复任务”或“继续执行”。",
    ];
  }

  public async handleUserInput(rawInput: string): Promise<string[]> {
    const input = rawInput.trim();

    if (!input && this.pendingStep !== "collect_project_dir" && this.pendingStep !== "collect_artifact_dir") {
      return ["请输入需求或任务控制指令。"];
    }

    if (this.pendingStep && input) {
      // 控制指令必须优先于资料收集处理，这样用户在追问阶段也能取消
      // 或恢复任务，而不会被误判成普通资料输入。
      const pendingControlLines = await this.handlePendingStepControlIntent(input);

      if (pendingControlLines) {
        return pendingControlLines;
      }
    }

    if (this.pendingStep) {
      return this.handlePendingStep(input);
    }

    // 当 Intake 不再处于追问阶段后，所有输入都先经过统一意图归一化，
    // 然后才决定是否触达 Runtime。
    const hasActiveTask = this.hasActiveTask();
    const intent = normalizeUserIntent(input, hasActiveTask);

    if (intent.type === "out_of_scope") {
      return [OUT_OF_SCOPE_REPLY];
    }

    if (intent.type === "resume_task") {
      return this.resumeTask(intent.normalizedMessage);
    }

    if (intent.type === "cancel_task") {
      return this.cancelTask(intent.normalizedMessage);
    }

    if (intent.type === "participate" && this.runtime) {
      return this.dispatchRuntimeEvent("participate", intent.normalizedMessage);
    }

    return this.startDraftTask(intent.normalizedMessage);
  }

  public async handleInterruptSignal(): Promise<{
    lines: string[];
    shouldExit: boolean;
  }> {
    if (!this.runtime || this.isTerminalTaskState()) {
      return {
        lines: ["没有运行中的任务，CLI 即将退出。"],
        shouldExit: true,
      };
    }

    if (this.runtime.taskState.status === "interrupted") {
      return {
        lines: ["任务已经处于中断态，CLI 即将退出。"],
        shouldExit: true,
      };
    }

    const lines = await this.dispatchRuntimeEvent(
      "interrupt_task",
      "Interrupted by control + C.",
    );

    return {
      lines,
      shouldExit: false,
    };
  }

  public shouldHandleInputAsLiveParticipation(rawInput: string): boolean {
    const input = rawInput.trim();

    if (
      input.length === 0 ||
      this.pendingStep ||
      !this.runtime ||
      this.runtime.taskState.status !== TaskStatus.RUNNING
    ) {
      return false;
    }

    // CLI 只对“运行中补充说明”开放并行透传；
    // 取消、恢复、超范围等控制语义仍保留在主串行链路里处理。
    return normalizeUserIntent(input, true).type === "participate";
  }

  public async dispose(): Promise<void> {
    if (!this.runtime) {
      return;
    }

    try {
      // Role 子命令行的统一回收时机收口到 Intake 生命周期，
      // 任务终态后也允许继续保留，直到宿主 CLI/Intake 结束。
      await this.runtime.roleRegistry.disposeAll?.();
    } finally {
      this.runtime.eventEmitter.removeAllListeners("workflow_event");
      this.runtime = undefined;
      this.persistedContext = undefined;
      this.workflowOutputBuffer = [];
    }
  }

  private async handlePendingStep(input: string): Promise<string[]> {
    switch (this.pendingStep) {
      case "confirm_workflow":
        if (isTruthyAnswer(input)) {
          return this.confirmWorkflowProfile();
        }

        if (isFalsyAnswer(input)) {
          this.pendingStep = "select_workflow";
          return [
            "请在以下类型中重新选择：Feature Change / Bugfix / Small New Feature。",
          ];
        }

        return ["请回答 yes/no，或输入 是/否。"];
      case "confirm_workflow_profile":
        return this.handleWorkflowProfileConfirmation(input);
      case "select_workflow":
        return this.selectWorkflowFromUserInput(input);
      case "collect_project_dir":
        return this.collectProjectDir(input);
      case "collect_artifact_dir":
        return this.collectArtifactDir(input);
      default:
        return ["当前输入状态无效，请重新描述任务。"];
    }
  }

  private async startDraftTask(description: string): Promise<string[]> {
    const workflowGuess = inferWorkflowTaskType(description);
    const workflow = createWorkflowSelection(workflowGuess.taskType);
    // draft 只保存 Runtime 初始化前必须补齐的资料，
    // 真正的 Runtime 会在资料确认完成后一次性创建。
    this.draft = {
      description,
      workflow,
      workflowPhases: createDefaultWorkflowPhases(),
    };
    this.pendingStep = "confirm_workflow";

    return [
      `我理解这更像是 ${workflow.label}，将使用 ${workflow.id}。`,
      describeWorkflowGuess(workflowGuess.taskType),
      "是不是想要这个类型？请回答 yes/no。",
    ];
  }

  private async selectWorkflowFromUserInput(input: string): Promise<string[]> {
    const workflowType = parseWorkflowSelectionInput(input);

    if (!workflowType) {
      return [
        "无法识别任务类型，请明确输入 Bugfix、Feature Change 或 Small New Feature。",
      ];
    }

    if (!this.draft) {
      return this.startDraftTask(input);
    }

    this.draft.workflow = createWorkflowSelection(workflowType);
    // 当前版本只支持一套 default workflow profile，
    // 但仍显式保留 workflowPhases，避免再次退回“只有 workflow 类型”的简化模型。
    this.draft.workflowPhases = createDefaultWorkflowPhases();
    this.pendingStep = "confirm_workflow_profile";

    return [
      `已切换为 ${this.draft.workflow.label}。`,
      this.getWorkflowProfilePrompt(),
    ];
  }

  private async collectProjectDir(input: string): Promise<string[]> {
    if (!this.draft) {
      return this.resetDraftWithMessage("缺少任务草稿，请重新描述任务。");
    }

    const projectDir = normalizeDirectoryInput(input, this.cwd);
    const projectStats = await fs.stat(projectDir).catch(() => null);

    if (!projectStats || !projectStats.isDirectory()) {
      return [`目标项目目录不存在或不可访问：${projectDir}`];
    }

    this.draft.projectDir = projectDir;
    this.pendingStep = "collect_artifact_dir";

    return [
      `目标项目目录已确认：${projectDir}`,
      `请提供工件保存目录。直接回车将使用默认目录：${path.resolve(projectDir, DEFAULT_ARTIFACT_DIR_NAME)}`,
    ];
  }

  private async collectArtifactDir(input: string): Promise<string[]> {
    if (
      !this.draft?.projectDir ||
      !this.draft.workflow ||
      !this.draft.workflowPhases
    ) {
      return this.resetDraftWithMessage("Runtime 初始化资料不完整，请重新描述任务。");
    }

    // 工件目录在启动前就创建出来，避免 Workflow 运行到一半才暴露路径问题。
    const artifactDir = resolveArtifactDir(this.draft.projectDir, normalizeArtifactInput(input));
    await fs.mkdir(artifactDir, { recursive: true });
    this.draft.artifactDir = artifactDir;
    this.pendingStep = undefined;

    return this.initializeRuntimeAndStartTask();
  }

  private async initializeRuntimeAndStartTask(): Promise<string[]> {
    if (
      !this.draft?.projectDir ||
      !this.draft.workflow ||
      !this.draft.workflowPhases ||
      !this.draft.artifactDir
    ) {
      return this.resetDraftWithMessage("Runtime 初始化资料缺失，无法启动任务。");
    }

    // 只有 Intake 收齐最小初始化资料后，才允许真正创建 Runtime。
    const buildResult = await buildRuntimeForNewTask({
      projectDir: this.draft.projectDir,
      artifactDir: this.draft.artifactDir,
      workflow: this.draft.workflow,
      workflowPhases: this.draft.workflowPhases,
      description: this.draft.description,
    });

    this.attachRuntime(buildResult.runtime, buildResult.persistedContext);
    // 在工件目录之外额外保存最近可恢复任务索引，确保后续 CLI 会话
    // 也能准确恢复使用自定义工件目录的任务。
    await this.saveResumeIndex(buildResult.persistedContext);

    const lines = [
      `Runtime 初始化成功：${buildResult.runtime.runtimeId}`,
      `任务类型：${buildResult.runtime.projectConfig.workflow.label}`,
      `流程编排：${buildResult.runtime.projectConfig.workflowProfileLabel} (${formatWorkflowPhases(buildResult.runtime.projectConfig.workflowPhases)})`,
      `工件目录：${buildResult.runtime.projectConfig.artifactDir}`,
      ...buildResult.capabilityWarnings.map((warning) => `说明：${warning}`),
    ];

    lines.push(
      ...(await this.dispatchRuntimeEvent(
        "init_task",
        this.draft.description,
        {
          title: buildResult.runtime.taskState.title,
          workflow: buildResult.runtime.projectConfig.workflow,
          workflowProfileLabel:
            buildResult.runtime.projectConfig.workflowProfileLabel,
          workflowPhases: buildResult.runtime.projectConfig.workflowPhases,
        },
      )),
    );
    // init_task 和 start_task 分开发送，
    // 让“完成初始化”和“正式执行”成为两个可观察的状态节点。
    lines.push(
      ...(await this.dispatchRuntimeEvent("start_task", this.draft.description)),
    );

    this.draft = undefined;

    return lines;
  }

  private async resumeTask(message: string): Promise<string[]> {
    if (this.runtime && !this.isTerminalTaskState()) {
      if (this.runtime.taskState.status === TaskStatus.RUNNING) {
        // 运行中的任务已经处于主流程内，不能再触发 resume_task；
        // 否则 Workflow 会把当前 phase 重新置回 pending 并重跑一轮。
        return ["当前任务正在执行中，无需恢复。"];
      }

      return this.dispatchRuntimeEvent("resume_task", message);
    }

    // 先使用显式记录的恢复索引，再回退到默认工件目录扫描，
    // 这样既能保证准确性，也保留兼容路径。
    const persistedContext =
      (await this.loadCurrentPersistedContext()) ??
      (await this.loadLatestPersistedContextFromDisk());

    if (!persistedContext) {
      return ["未找到可恢复的未完成任务。"];
    }

    const buildResult = await buildRuntimeForResume({
      projectConfig: persistedContext.projectConfig,
      persistedContext,
    });

    this.attachRuntime(buildResult.runtime, buildResult.persistedContext);
    await this.saveResumeIndex(buildResult.persistedContext);

    const lines = [
      `Runtime 已重建：${buildResult.runtime.runtimeId}`,
      `恢复任务：${buildResult.runtime.taskState.taskId}`,
      ...buildResult.capabilityWarnings.map((warning) => `说明：${warning}`),
    ];

    lines.push(...(await this.dispatchRuntimeEvent("resume_task", message)));
    return lines;
  }

  private async cancelTask(message: string): Promise<string[]> {
    if (this.pendingStep && !this.runtime) {
      this.draft = undefined;
      this.pendingStep = undefined;
      return ["已取消当前任务创建流程。"];
    }

    if (!this.runtime || this.isTerminalTaskState()) {
      return ["当前没有可取消的任务。"];
    }

    const lines = await this.dispatchRuntimeEvent("cancel_task", message);
    await this.clearResumeIndexForTask(this.runtime.taskState.taskId);
    return lines;
  }

  private async dispatchRuntimeEvent(
    type: IntakeEventType,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<string[]> {
    if (!this.runtime) {
      return ["Runtime 尚未初始化。"];
    }

    const intakeEvent: IntakeEvent = {
      type,
      taskId: this.runtime.taskState.taskId,
      message,
      timestamp: Date.now(),
      metadata,
    };

    this.workflowOutputBuffer = [];
    // 只有 WorkflowController 可以推进 TaskState。
    // Intake 只负责转发规范化后的事件并渲染结果。
    await this.runtime.workflow.handleIntakeEvent(intakeEvent);
    // 任务走到终止态后立即清理恢复索引，避免 CLI 错把已结束任务当成可恢复任务。
    if (this.isTerminalTaskState()) {
      await this.clearResumeIndexForTask(this.runtime.taskState.taskId);
    }
    return this.workflowOutputBuffer.splice(0, this.workflowOutputBuffer.length);
  }

  private attachRuntime(runtime: Runtime, persistedContext: PersistedTaskContext): void {
    this.runtime = runtime;
    this.persistedContext = persistedContext;
    this.workflowOutputBuffer = [];
    runtime.eventEmitter.removeAllListeners("workflow_event");
    // 每次 Runtime 重建后都重新绑定事件监听，
    // 避免中断恢复时复用旧的内存监听器。
    runtime.eventEmitter.on("workflow_event", (event: WorkflowEvent) => {
      const lines = this.formatWorkflowEvent(event);

      if (this.options.onWorkflowOutput) {
        this.options.onWorkflowOutput(lines);
        return;
      }

      this.workflowOutputBuffer.push(...lines);
    });
  }

  private formatWorkflowEvent(event: WorkflowEvent): string[] {
    return formatWorkflowEventForCli(event);
  }

  private async loadCurrentPersistedContext(): Promise<PersistedTaskContext | null> {
    if (!this.runtime) {
      return null;
    }

    return this.runtime.artifactManager
      .loadTaskContext(this.runtime.taskState.taskId)
      .catch(() => null);
  }

  private async loadLatestPersistedContextFromDisk(): Promise<PersistedTaskContext | null> {
    const indexedTask = await this.loadPersistedContextFromResumeIndex();

    if (indexedTask) {
      // 优先使用显式索引，确保自定义 artifactDir 的任务也能准确恢复。
      return indexedTask;
    }

    const artifactDir = path.resolve(this.cwd, DEFAULT_ARTIFACT_DIR_NAME);
    return findLatestPersistedTask(artifactDir);
  }

  private hasActiveTask(): boolean {
    return Boolean(this.runtime) && !this.isTerminalTaskState();
  }

  private isTerminalTaskState(): boolean {
    return (
      this.runtime?.taskState.status === "completed" ||
      this.runtime?.taskState.status === "failed"
    );
  }

  private resetDraftWithMessage(message: string): string[] {
    this.draft = undefined;
    this.pendingStep = undefined;
    return [message];
  }

  private async handlePendingStepControlIntent(
    input: string,
  ): Promise<string[] | null> {
    // 追问阶段也需要和主循环一样支持控制指令，
    // 否则“取消任务”会被误当成项目资料。
    const intent = normalizeUserIntent(input, this.hasActiveTask());

    if (intent.type === "cancel_task") {
      return this.cancelTask(intent.normalizedMessage);
    }

    if (intent.type === "resume_task") {
      this.draft = undefined;
      this.pendingStep = undefined;
      return this.resumeTask(intent.normalizedMessage);
    }

    if (intent.type === "out_of_scope") {
      return [OUT_OF_SCOPE_REPLY];
    }

    return null;
  }

  private confirmWorkflowProfile(): string[] {
    this.pendingStep = "confirm_workflow_profile";
    return [this.getWorkflowProfilePrompt()];
  }

  private handleWorkflowProfileConfirmation(input: string): string[] {
    if (isTruthyAnswer(input) || /^(默认|default-v0\.1|default)$/i.test(input)) {
      this.pendingStep = "collect_project_dir";
      return [
        "请提供目标项目目录。直接回车、输入“默认”或“当前目录”将使用当前工作目录。",
      ];
    }

    if (isFalsyAnswer(input)) {
      return [
        "当前版本仅支持 default-workflow/v0.1 编排。若接受该编排请输入 yes，或输入“取消任务”。",
      ];
    }

    return [
      "请确认是否使用当前 workflow 编排。可输入 yes/no，或输入 default-v0.1。",
    ];
  }

  private getWorkflowProfilePrompt(): string {
    const phases = formatWorkflowPhases(
      this.draft?.workflowPhases ?? createDefaultWorkflowPhases(),
    );
    return `当前 workflow 编排将使用 default-workflow/v0.1：${phases}。是否确认？请回答 yes/no。`;
  }

  private getResumeIndexPath(): string {
    return path.resolve(this.cwd, INTAKE_STATE_DIR_NAME, INTAKE_RESUME_INDEX_FILE);
  }

  private async saveResumeIndex(
    persistedContext: PersistedTaskContext,
  ): Promise<void> {
    const resumeIndexPath = this.getResumeIndexPath();
    // 把 artifactDir 和 taskId 一起记录下来，
    // 这样恢复时才能重新定位自定义工件目录下的任务。
    const snapshot: ResumeIndexSnapshot = {
      taskId: persistedContext.taskId,
      artifactDir: persistedContext.projectConfig.artifactDir,
      updatedAt: Date.now(),
    };

    await fs.mkdir(path.dirname(resumeIndexPath), { recursive: true });
    await fs.writeFile(resumeIndexPath, JSON.stringify(snapshot, null, 2), "utf8");
  }

  private async loadPersistedContextFromResumeIndex(): Promise<PersistedTaskContext | null> {
    try {
      const content = await fs.readFile(this.getResumeIndexPath(), "utf8");
      const snapshot = JSON.parse(content) as ResumeIndexSnapshot;
      return loadPersistedTaskById(snapshot.artifactDir, snapshot.taskId);
    } catch {
      return null;
    }
  }

  private async clearResumeIndexForTask(taskId: string): Promise<void> {
    try {
      const resumeIndexPath = this.getResumeIndexPath();
      const content = await fs.readFile(resumeIndexPath, "utf8");
      const snapshot = JSON.parse(content) as ResumeIndexSnapshot;

      if (snapshot.taskId !== taskId) {
        return;
      }

      // 保持索引文件结构稳定，只在任务进入终止态后清空当前指针。
      await fs.writeFile(
        resumeIndexPath,
        JSON.stringify(
          {
            taskId: "",
            artifactDir: "",
            updatedAt: Date.now(),
          } satisfies ResumeIndexSnapshot,
          null,
          2,
        ),
        "utf8",
      );
    } catch {
      return;
    }
  }
}

function normalizeDirectoryInput(input: string, cwd: string): string {
  if (!input || /^(默认|当前目录|current|default)$/i.test(input)) {
    return cwd;
  }

  return path.resolve(cwd, input);
}

function normalizeArtifactInput(input: string): string | undefined {
  if (!input || /^(默认|default)$/i.test(input)) {
    return undefined;
  }

  return input;
}

function parseWorkflowSelectionInput(input: string): WorkflowTaskType | null {
  const normalized = input.trim().toLowerCase();

  if (
    normalized.includes("bugfix") ||
    normalized.includes("bug") ||
    normalized.includes("修复")
  ) {
    return "bugfix";
  }

  if (
    normalized.includes("small new feature") ||
    normalized.includes("new feature") ||
    normalized.includes("新增") ||
    normalized.includes("新功能")
  ) {
    return "small_new_feature";
  }

  if (
    normalized.includes("feature change") ||
    normalized.includes("change") ||
    normalized.includes("调整") ||
    normalized.includes("修改")
  ) {
    return "feature_change";
  }

  return null;
}

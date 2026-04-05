import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactManager,
  ArtifactReader,
  Phase,
  PersistedTaskContext,
  ProjectConfig,
  TaskDebugEvent,
  TaskArtifact,
  TaskState,
  WorkflowEvent,
} from "../shared/types";

function getTasksRoot(projectConfig: ProjectConfig): string {
  return path.join(projectConfig.artifactDir, "tasks");
}

function getTaskRoot(projectConfig: ProjectConfig, taskId: string): string {
  return path.join(getTasksRoot(projectConfig), taskId);
}

export function getTaskRuntimeRoot(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRoot(projectConfig, taskId), "runtime");
}

function getTaskStateJsonPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRuntimeRoot(projectConfig, taskId), "task-state.json");
}

function getLegacyTaskStateJsonPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRoot(projectConfig, taskId), "task-state.json");
}

function getTaskStateMarkdownPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRuntimeRoot(projectConfig, taskId), "task-state.md");
}

function getTaskContextPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRuntimeRoot(projectConfig, taskId), "task-context.json");
}

function getLegacyTaskContextPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRoot(projectConfig, taskId), "task-context.json");
}

export function getTaskWorkflowEventsPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRuntimeRoot(projectConfig, taskId), "workflow-events.jsonl");
}

export function getTaskDebugEventsPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRuntimeRoot(projectConfig, taskId), "debug-events.jsonl");
}

export function getTaskDebugTranscriptPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRuntimeRoot(projectConfig, taskId), "debug-transcript.md");
}

function getArtifactsRoot(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRoot(projectConfig, taskId), "artifacts");
}

export class FileArtifactManager implements ArtifactManager {
  public constructor(private readonly projectConfig: ProjectConfig) {}

  public async initializeTask(taskId: string): Promise<void> {
    await fs.mkdir(getTaskRoot(this.projectConfig, taskId), {
      recursive: true,
    });
    await fs.mkdir(getTaskRuntimeRoot(this.projectConfig, taskId), {
      recursive: true,
    });
    await fs.mkdir(getArtifactsRoot(this.projectConfig, taskId), {
      recursive: true,
    });
    await ensureFileExists(getTaskDebugEventsPath(this.projectConfig, taskId), "");
    await ensureFileExists(
      getTaskDebugTranscriptPath(this.projectConfig, taskId),
      renderTaskDebugTranscript({
        taskId,
      }),
    );
  }

  public async saveTaskState(taskState: TaskState): Promise<string> {
    const jsonPath = getTaskStateJsonPath(this.projectConfig, taskState.taskId);
    const markdownPath = getTaskStateMarkdownPath(
      this.projectConfig,
      taskState.taskId,
    );
    await this.initializeTask(taskState.taskId);
    await fs.writeFile(jsonPath, JSON.stringify(taskState, null, 2), "utf8");
    await fs.writeFile(markdownPath, renderTaskStateMarkdown(taskState), "utf8");
    await this.refreshTaskDebugTranscript(taskState.taskId);
    return markdownPath;
  }

  public async saveTaskContext(context: PersistedTaskContext): Promise<string> {
    const filePath = getTaskContextPath(this.projectConfig, context.taskId);
    await this.initializeTask(context.taskId);
    await fs.writeFile(filePath, JSON.stringify(context, null, 2), "utf8");
    await this.refreshTaskDebugTranscript(context.taskId);
    return filePath;
  }

  public async appendDebugEvent(
    taskId: string,
    event: TaskDebugEvent,
  ): Promise<string> {
    return this.appendDebugEvents(taskId, [event]);
  }

  public async appendDebugEvents(
    taskId: string,
    events: TaskDebugEvent[],
  ): Promise<string> {
    const filePath = getTaskDebugEventsPath(this.projectConfig, taskId);
    await this.initializeTask(taskId);

    if (events.length > 0) {
      const payload = events.map((event) => `${JSON.stringify(event)}\n`).join("");
      await fs.appendFile(filePath, payload, "utf8");
    }

    await this.refreshTaskDebugTranscript(taskId);
    return filePath;
  }

  public async saveArtifact(
    taskId: string,
    artifact: TaskArtifact,
  ): Promise<string> {
    const artifactDir = path.join(getArtifactsRoot(this.projectConfig, taskId), artifact.phase);
    const artifactFilePath = path.join(artifactDir, `${artifact.key}.md`);
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(artifactFilePath, artifact.content, "utf8");
    return artifactFilePath;
  }

  public createArtifactReader(taskId: string): ArtifactReader {
    return {
      get: async (key: string) => this.readArtifactContent(taskId, key),
      list: async (phase?: Phase) => this.listArtifactKeys(taskId, phase),
    };
  }

  public async loadTaskState(taskId: string): Promise<TaskState> {
    return readJsonFileWithFallback<TaskState>(
      getTaskStateJsonPath(this.projectConfig, taskId),
      getLegacyTaskStateJsonPath(this.projectConfig, taskId),
    );
  }

  public async loadTaskContext(taskId: string): Promise<PersistedTaskContext> {
    return readJsonFileWithFallback<PersistedTaskContext>(
      getTaskContextPath(this.projectConfig, taskId),
      getLegacyTaskContextPath(this.projectConfig, taskId),
    );
  }

  public async findLatestResumableTaskId(): Promise<string | null> {
    const tasksRoot = getTasksRoot(this.projectConfig);

    try {
      const taskEntries = await fs.readdir(tasksRoot, { withFileTypes: true });
      const candidates: Array<{
        taskId: string;
        updatedAt: number;
      }> = [];

      for (const entry of taskEntries) {
        if (!entry.isDirectory()) {
          continue;
        }

        try {
          const taskState = await this.loadTaskState(entry.name);

          if (
            taskState.status === "completed" ||
            taskState.status === "failed"
          ) {
            continue;
          }

          candidates.push({
            taskId: entry.name,
            updatedAt: taskState.updatedAt,
          });
        } catch {
          continue;
        }
      }

      candidates.sort((left, right) => right.updatedAt - left.updatedAt);
      return candidates[0]?.taskId ?? null;
    } catch {
      return null;
    }
  }

  private async listArtifactKeys(
    taskId: string,
    phase?: Phase,
  ): Promise<string[]> {
    return listArtifactKeysFromRoot(getArtifactsRoot(this.projectConfig, taskId), phase);
  }

  private async readArtifactContent(
    taskId: string,
    key: string,
  ): Promise<string | undefined> {
    return readArtifactByKey(getArtifactsRoot(this.projectConfig, taskId), key);
  }

  private async refreshTaskDebugTranscript(taskId: string): Promise<void> {
    const transcriptPath = getTaskDebugTranscriptPath(this.projectConfig, taskId);
    const [taskState, taskContext, debugEvents] = await Promise.all([
      this.readTaskStateForTranscript(taskId),
      this.readTaskContextForTranscript(taskId),
      readDebugEvents(getTaskDebugEventsPath(this.projectConfig, taskId)),
    ]);

    await fs.writeFile(
      transcriptPath,
      renderTaskDebugTranscript({
        taskId,
        taskState,
        taskContext,
        debugEvents,
      }),
      "utf8",
    );
  }

  private async readTaskStateForTranscript(taskId: string): Promise<TaskState | undefined> {
    try {
      return await this.loadTaskState(taskId);
    } catch {
      return undefined;
    }
  }

  private async readTaskContextForTranscript(
    taskId: string,
  ): Promise<PersistedTaskContext | undefined> {
    try {
      return await this.loadTaskContext(taskId);
    } catch {
      return undefined;
    }
  }
}

async function listArtifactKeysFromRoot(
  artifactsRoot: string,
  phase?: Phase,
): Promise<string[]> {
  if (phase) {
    try {
      const entries = await fs.readdir(path.join(artifactsRoot, phase), {
        withFileTypes: true,
      });

      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name.replace(/\.md$/, ""));
    } catch {
      return [];
    }
  }

  try {
    const phaseEntries = await fs.readdir(artifactsRoot, { withFileTypes: true });
    const keys: string[] = [];

    for (const phaseEntry of phaseEntries) {
      if (!phaseEntry.isDirectory()) {
        continue;
      }

      const files = await listArtifactKeysFromRoot(
        artifactsRoot,
        phaseEntry.name as Phase,
      );
      keys.push(...files.map((file) => `${phaseEntry.name}/${file}`));
    }

    return keys;
  } catch {
    return [];
  }
}

async function readArtifactByKey(
  artifactsRoot: string,
  key: string,
): Promise<string | undefined> {
  const [phase, localKey] = key.includes("/") ? key.split("/", 2) : [undefined, key];

  if (phase && localKey) {
    return readUtf8IfExists(path.join(artifactsRoot, phase, `${localKey}.md`));
  }

  const allKeys = await listArtifactKeysFromRoot(artifactsRoot);

  for (const artifactKey of allKeys) {
    if (!artifactKey.endsWith(`/${key}`)) {
      continue;
    }

    const [matchedPhase, matchedLocalKey] = artifactKey.split("/", 2);
    return readUtf8IfExists(
      path.join(artifactsRoot, matchedPhase, `${matchedLocalKey}.md`),
    );
  }

  return undefined;
}

function renderTaskStateMarkdown(taskState: TaskState): string {
  return [
    "# Task Snapshot",
    "",
    `- taskId: ${taskState.taskId}`,
    `- title: ${taskState.title}`,
    `- currentPhase: ${taskState.currentPhase}`,
    `- phaseStatus: ${taskState.phaseStatus}`,
    `- status: ${taskState.status}`,
    `- updatedAt: ${taskState.updatedAt}`,
    `- resumeFrom: ${taskState.resumeFrom ? JSON.stringify(taskState.resumeFrom) : "none"}`,
    "",
    "```json",
    JSON.stringify(taskState, null, 2),
    "```",
  ].join("\n");
}

function renderTaskDebugTranscript(input: {
  taskId: string;
  taskState?: TaskState;
  taskContext?: PersistedTaskContext;
  debugEvents?: TaskDebugEvent[];
}): string {
  const debugEvents = [...(input.debugEvents ?? [])].sort(
    (left, right) => left.timestamp - right.timestamp,
  );
  const lastEvent = debugEvents.at(-1);
  const latestError = [...debugEvents]
    .reverse()
    .find(isFailureDebugEvent);
  const latestExecutorFailure = [...debugEvents]
    .reverse()
    .find(
      (event) =>
        event.type === "executor_stderr" ||
        (event.type === "executor_exit" &&
          event.metadata &&
          ((typeof event.metadata.code === "number" && event.metadata.code !== 0) ||
            event.metadata.timedOut === true ||
            (typeof event.metadata.signal === "string" && event.metadata.signal.length > 0))),
    );
  const lastUserInput = [...debugEvents]
    .reverse()
    .find((event) => event.type === "user_input");
  const workflowName =
    input.taskContext?.projectConfig.workflowProfileLabel ??
    input.taskContext?.projectConfig.workflow.name ??
    "-";
  const activeRole =
    input.taskState?.resumeFrom?.roleName ??
    lastEvent?.roleName ??
    "-";
  const taskSummary =
    input.taskContext?.description ??
    input.taskContext?.title ??
    input.taskState?.title ??
    "-";

  const sections = [
    "# Task Debug Transcript",
    "",
    "## 任务概览",
    "",
    `- taskId: ${input.taskId}`,
    `- title: ${input.taskState?.title ?? input.taskContext?.title ?? "-"}`,
    `- description: ${taskSummary}`,
    `- workflow: ${workflowName}`,
    `- projectDir: ${input.taskContext?.projectConfig.projectDir ?? "-"}`,
    `- artifactDir: ${input.taskContext?.projectConfig.artifactDir ?? "-"}`,
    `- createdAt: ${formatTimestamp(input.taskContext?.createdAt)}`,
    `- updatedAt: ${formatTimestamp(input.taskState?.updatedAt)}`,
    `- status: ${input.taskState?.status ?? "-"}`,
    `- phase: ${input.taskState?.currentPhase ?? "-"}`,
    `- activeRole: ${activeRole}`,
    `- latestInput: ${input.taskContext?.latestInput ?? "-"}`,
    `- runtimeFiles: task-state.json, task-state.md, task-context.json, workflow-events.jsonl, debug-events.jsonl`,
    "",
    "## 结果摘要",
    "",
    latestError
      ? `- failureSummary: ${latestError.message ?? extractDebugEventText(latestError)}`
      : `- completionSummary: ${buildCompletionSummary(input.taskState, debugEvents)}`,
    latestError
      ? `- rawError: ${extractDebugEventRaw(latestError)}`
      : "- rawError: none",
    `- lastUserInput: ${lastUserInput ? extractDebugEventText(lastUserInput) : "-"}`,
    `- lastKeyEvent: ${lastEvent ? summarizeDebugEvent(lastEvent) : "-"}`,
    `- latestExecutorSignal: ${latestExecutorFailure ? summarizeDebugEvent(latestExecutorFailure) : "-"}`,
    "",
    latestError ? "## 关键错误" : "## 关键说明",
    "",
    latestError
      ? renderHighlightedEvents([
          latestError,
          ...(latestExecutorFailure && latestExecutorFailure !== latestError
            ? [latestExecutorFailure]
            : []),
        ])
      : "- 当前未记录失败事件。",
    "",
    "## 时间线",
    "",
    debugEvents.length > 0
      ? debugEvents.map(renderTimelineEntry).join("\n\n")
      : "- 暂无调试事件。",
    "",
    "## 原始输出附录",
    "",
    renderRawOutputAppendix(debugEvents),
  ];

  return sections.join("\n");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}

async function readDebugEvents(filePath: string): Promise<TaskDebugEvent[]> {
  const content = await readUtf8IfExists(filePath);

  if (!content) {
    return [];
  }

  const events: TaskDebugEvent[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      events.push(JSON.parse(trimmed) as TaskDebugEvent);
    } catch {
      continue;
    }
  }

  return events;
}

async function readJsonFileWithFallback<T>(
  primaryPath: string,
  fallbackPath: string,
): Promise<T> {
  try {
    return await readJsonFile<T>(primaryPath);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }

    return readJsonFile<T>(fallbackPath);
  }
}

async function readUtf8IfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function ensureFileExists(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await fs.stat(filePath);
  } catch {
    await fs.writeFile(filePath, content, "utf8");
  }
}

function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function buildCompletionSummary(
  taskState: TaskState | undefined,
  debugEvents: TaskDebugEvent[],
): string {
  if (!taskState) {
    return "任务尚未完成初始化。";
  }

  if (taskState.status === "failed") {
    return "任务失败。";
  }

  if (taskState.status === "completed") {
    return "任务完成。";
  }

  return `任务当前处于 ${taskState.status}，最近共有 ${debugEvents.length} 条调试事件。`;
}

function renderHighlightedEvents(events: TaskDebugEvent[]): string {
  if (events.length === 0) {
    return "- 无。";
  }

  return events.map(renderTimelineEntry).join("\n\n");
}

function renderTimelineEntry(event: TaskDebugEvent): string {
  const header = `- [${formatTimestamp(event.timestamp)}] ${getDebugEventLabel(event)}`;
  const mainText = extractDebugEventText(event);
  const metadataText = renderDebugMetadata(event.metadata);
  const payloadText = renderDebugPayload(event.payload);

  return [header, mainText, metadataText, payloadText]
    .filter((item) => item.length > 0)
    .join("\n");
}

function renderRawOutputAppendix(debugEvents: TaskDebugEvent[]): string {
  const rawEvents = debugEvents.filter(
    (event) =>
      event.type === "executor_stdout" ||
      event.type === "executor_stderr" ||
      event.type === "executor_result_payload" ||
      event.type === "executor_exit",
  );

  if (rawEvents.length === 0) {
    return "- 暂无底层执行原始输出。";
  }

  return rawEvents.map(renderTimelineEntry).join("\n\n");
}

function getDebugEventLabel(event: TaskDebugEvent): string {
  switch (event.type) {
    case "user_input":
      return "[用户输入]";
    case "intake_message":
      return "[Intake 消息]";
    case "workflow_event":
      return `[Workflow 事件${resolveWorkflowEventSuffix(event.payload)}]`;
    case "role_visible_output":
      return "[AI 可见输出]";
    case "executor_stdout":
      return "[Executor stdout]";
    case "executor_stderr":
      return "[Executor stderr]";
    case "executor_exit":
      return "[Executor 退出]";
    case "executor_result_payload":
      return "[Executor 最终结果]";
    case "error":
      return "[错误]";
    case "snapshot_reference":
      return "[快照引用]";
    default:
      return `[${event.type}]`;
  }
}

function resolveWorkflowEventSuffix(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const workflowEvent = payload as WorkflowEvent;
  return typeof workflowEvent.type === "string" ? `:${workflowEvent.type}` : "";
}

function extractDebugEventText(event: TaskDebugEvent): string {
  if (typeof event.message === "string" && event.message.length > 0) {
    return indentMultiline(event.message);
  }

  if (typeof event.payload === "string" && event.payload.length > 0) {
    return indentMultiline(event.payload);
  }

  if (event.type === "workflow_event" && event.payload && typeof event.payload === "object") {
    const workflowEvent = event.payload as WorkflowEvent;
    if (typeof workflowEvent.message === "string" && workflowEvent.message.length > 0) {
      return indentMultiline(workflowEvent.message);
    }
  }

  return "";
}

function extractDebugEventRaw(event: TaskDebugEvent): string {
  if (typeof event.payload === "string" && event.payload.length > 0) {
    return event.payload;
  }

  if (event.type === "workflow_event" && event.payload && typeof event.payload === "object") {
    const workflowEvent = event.payload as WorkflowEvent;

    if (typeof workflowEvent.metadata?.error === "string") {
      return workflowEvent.metadata.error;
    }
  }

  if (event.metadata?.rawError && typeof event.metadata.rawError === "string") {
    return event.metadata.rawError;
  }

  return event.message ?? "-";
}

function summarizeDebugEvent(event: TaskDebugEvent): string {
  const base = `${getDebugEventLabel(event)} ${event.message ?? extractDebugEventText(event)}`;
  const compact = base.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function isFailureDebugEvent(event: TaskDebugEvent): boolean {
  if (event.type === "error") {
    return true;
  }

  if (event.type !== "workflow_event" || !event.payload || typeof event.payload !== "object") {
    return false;
  }

  const workflowEvent = event.payload as WorkflowEvent;
  return workflowEvent.type === "error";
}

function renderDebugMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "";
  }

  return indentMultiline(`metadata: ${JSON.stringify(metadata, null, 2)}`);
}

function renderDebugPayload(payload: unknown): string {
  if (payload === undefined || payload === null || typeof payload === "string") {
    return "";
  }

  return indentMultiline(`payload: ${JSON.stringify(payload, null, 2)}`);
}

function indentMultiline(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatTimestamp(timestamp: number | undefined): string {
  if (!timestamp) {
    return "-";
  }

  return new Date(timestamp).toISOString();
}

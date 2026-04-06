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
} from "../shared/types";
import { renderTaskDebugTranscript } from "./debug-transcript";

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
      renderTaskDebugTranscript({}),
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
    const debugEvents = await readDebugEvents(
      getTaskDebugEventsPath(this.projectConfig, taskId),
    );

    await fs.writeFile(
      transcriptPath,
      renderTaskDebugTranscript({ debugEvents }),
      "utf8",
    );
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

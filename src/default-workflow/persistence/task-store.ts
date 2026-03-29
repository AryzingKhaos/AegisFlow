import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactManager,
  PersistedTaskContext,
  ProjectConfig,
  TaskArtifact,
  TaskState,
} from "../shared/types";

function getTasksRoot(projectConfig: ProjectConfig): string {
  return path.join(projectConfig.artifactDir, "tasks");
}

function getTaskRoot(projectConfig: ProjectConfig, taskId: string): string {
  return path.join(getTasksRoot(projectConfig), taskId);
}

function getTaskStateJsonPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRoot(projectConfig, taskId), "task-state.json");
}

function getTaskStateMarkdownPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRoot(projectConfig, taskId), "task-state.md");
}

function getTaskContextPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRoot(projectConfig, taskId), "task-context.json");
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
    await fs.mkdir(getArtifactsRoot(this.projectConfig, taskId), {
      recursive: true,
    });
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
    return markdownPath;
  }

  public async saveTaskContext(context: PersistedTaskContext): Promise<string> {
    const filePath = getTaskContextPath(this.projectConfig, context.taskId);
    await this.initializeTask(context.taskId);
    await fs.writeFile(filePath, JSON.stringify(context, null, 2), "utf8");
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

  public async loadTaskState(taskId: string): Promise<TaskState> {
    return readJsonFile<TaskState>(getTaskStateJsonPath(this.projectConfig, taskId));
  }

  public async loadTaskContext(taskId: string): Promise<PersistedTaskContext> {
    return readJsonFile<PersistedTaskContext>(
      getTaskContextPath(this.projectConfig, taskId),
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

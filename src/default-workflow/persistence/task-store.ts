import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  ArtifactManager,
  PersistedTaskContext,
  ProjectConfig,
  TaskState,
} from "../shared/types";

function getTasksRoot(projectConfig: ProjectConfig): string {
  return path.join(projectConfig.artifactDir, "tasks");
}

function getTaskRoot(projectConfig: ProjectConfig, taskId: string): string {
  return path.join(getTasksRoot(projectConfig), taskId);
}

function getTaskStatePath(projectConfig: ProjectConfig, taskId: string): string {
  return path.join(getTaskRoot(projectConfig, taskId), "task-state.json");
}

function getTaskContextPath(
  projectConfig: ProjectConfig,
  taskId: string,
): string {
  return path.join(getTaskRoot(projectConfig, taskId), "task-context.json");
}

export class FileArtifactManager implements ArtifactManager {
  public constructor(private readonly projectConfig: ProjectConfig) {}

  public async initializeTask(taskId: string): Promise<void> {
    await fs.mkdir(getTaskRoot(this.projectConfig, taskId), {
      recursive: true,
    });
  }

  public async saveTaskState(taskState: TaskState): Promise<string> {
    const filePath = getTaskStatePath(this.projectConfig, taskState.taskId);
    await this.initializeTask(taskState.taskId);
    await fs.writeFile(filePath, JSON.stringify(taskState, null, 2), "utf8");
    return filePath;
  }

  public async saveTaskContext(context: PersistedTaskContext): Promise<string> {
    const filePath = getTaskContextPath(this.projectConfig, context.taskId);
    await this.initializeTask(context.taskId);
    await fs.writeFile(filePath, JSON.stringify(context, null, 2), "utf8");
    return filePath;
  }

  public async loadTaskState(taskId: string): Promise<TaskState> {
    return readJsonFile<TaskState>(getTaskStatePath(this.projectConfig, taskId));
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

        const taskStatePath = getTaskStatePath(this.projectConfig, entry.name);

        try {
          const taskState = await readJsonFile<TaskState>(taskStatePath);

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

async function readJsonFile<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as T;
}


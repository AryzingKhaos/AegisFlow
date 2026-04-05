import { promises as fs } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  FileArtifactManager,
  getTaskWorkflowEventsPath,
} from "../persistence/task-store";
import { DefaultWorkflowController } from "../workflow/controller";
import {
  createInitialTaskState,
  createProjectConfig,
  createRuntimeId,
  createTaskId,
  createTaskTitle,
  createWorkflowSelection,
} from "../shared/utils";
import type {
  PersistedTaskContext,
  ProjectConfig,
  Runtime,
  WorkflowPhaseConfig,
  WorkflowSelection,
} from "../shared/types";
import { DefaultRoleRegistry, JsonlEventLogger } from "./dependencies";
import {
  loadProjectRoleExecutorConfig,
  loadProjectWorkflowCatalog,
  type ProjectRoleExecutorOverride,
} from "./project-config";

export interface BuildNewRuntimeInput {
  projectDir: string;
  artifactDir: string;
  workflow: WorkflowSelection;
  workflowPhases: WorkflowPhaseConfig[];
  workflowProfileId?: string;
  workflowProfileLabel?: string;
  description: string;
}

export interface BuildResumeRuntimeInput {
  projectConfig: ProjectConfig;
  persistedContext: PersistedTaskContext;
}

export interface RuntimeBuildResult {
  runtime: Runtime;
  persistedContext: PersistedTaskContext;
  capabilityWarnings: string[];
}

export async function buildRuntimeForNewTask(
  input: BuildNewRuntimeInput,
): Promise<RuntimeBuildResult> {
  await validateRuntimeInput(
    input.projectDir,
    input.artifactDir,
    input.workflow,
    input.workflowPhases,
  );

  const runtimeId = createRuntimeId();
  const title = createTaskTitle(
    input.description,
    `${input.workflow.taskType ?? input.workflow.name ?? "workflow"}_task`,
  );
  const taskId = await createNextTaskId(input.artifactDir, title);
  // Runtime 装配顺序固定为：
  // 配置 -> 基础设施 -> 初始状态 -> WorkflowController。
  // 这样恢复和新建任务都能复用同一套初始化约束。
  const roleExecutor = await resolveProjectRoleExecutorConfig(input.projectDir);
  const projectConfig = createProjectConfig({
    projectDir: input.projectDir,
    artifactDir: input.artifactDir,
    workflow: input.workflow,
    workflowPhases: input.workflowPhases,
    workflowProfileId: input.workflowProfileId,
    workflowProfileLabel: input.workflowProfileLabel,
    roleExecutor,
  });
  const eventEmitter = new EventEmitter();
  const taskEventLogPath = getTaskWorkflowEventsPath(projectConfig, taskId);
  const eventLogger = new JsonlEventLogger(
    taskEventLogPath,
  );
  const artifactManager = new FileArtifactManager(projectConfig);
  const roleRegistry = new DefaultRoleRegistry({
    projectConfig,
    eventEmitter,
    eventLogger,
  });
  const taskState = createInitialTaskState(
    taskId,
    title,
    projectConfig.workflowPhases,
  );
  const workflow = new DefaultWorkflowController({
    taskState,
    projectConfig,
    eventEmitter,
    eventLogger,
    artifactManager,
    roleRegistry,
  });
  const runtime: Runtime = {
    runtimeId,
    taskState,
    workflow,
    projectConfig,
    eventEmitter,
    eventLogger,
    artifactManager,
    roleRegistry,
  };
  const persistedContext: PersistedTaskContext = {
    taskId,
    title,
    description: input.description,
    createdAt: Date.now(),
    lastRuntimeId: runtimeId,
    latestInput: input.description,
    projectConfig,
  };

  // Runtime 初始化完成后先把上下文和初始快照落盘，后续 run/resume 才能安全恢复。
  await artifactManager.initializeTask(taskId);
  await artifactManager.saveTaskContext(persistedContext);
  await artifactManager.saveTaskState(taskState);

  return {
    runtime,
    persistedContext,
    capabilityWarnings: [
      "RoleRegistry 已切换为 RoleDefinition + RoleRuntime 的受限注入机制，默认角色会通过统一 Agent 执行链路运行。",
      "如需离线验证，可设置 AEGISFLOW_ROLE_EXECUTION_MODE=stub；线上默认仍走真实模型调用。",
      "tester 当前按最小职责说明接入，后续仍可继续补充更细测试执行策略。",
    ],
  };
}

export async function buildRuntimeForResume(
  input: BuildResumeRuntimeInput,
): Promise<RuntimeBuildResult> {
  await validateRuntimeInput(
    input.projectConfig.projectDir,
    input.projectConfig.artifactDir,
    input.projectConfig.workflow,
    input.projectConfig.workflowPhases,
  );

  // 恢复必须基于持久化工件重建新的 Runtime，不能复用旧进程内存。
  const runtimeId = createRuntimeId();
  const roleExecutor = await resolveProjectRoleExecutorConfig(
    input.projectConfig.projectDir,
  );
  const projectConfig = createProjectConfig({
    ...input.projectConfig,
    roleExecutor,
  });
  const eventEmitter = new EventEmitter();
  const taskEventLogPath = getTaskWorkflowEventsPath(
    projectConfig,
    input.persistedContext.taskId,
  );
  const eventLogger = new JsonlEventLogger(
    taskEventLogPath,
  );
  const artifactManager = new FileArtifactManager(projectConfig);
  const roleRegistry = new DefaultRoleRegistry({
    projectConfig,
    eventEmitter,
    eventLogger,
  });
  // 恢复时以磁盘快照为准加载 TaskState，
  // 而不是沿用 persistedContext 中可能已经过期的内存副本。
  const taskState = await artifactManager.loadTaskState(
    input.persistedContext.taskId,
  );
  const workflow = new DefaultWorkflowController({
    taskState,
    projectConfig,
    eventEmitter,
    eventLogger,
    artifactManager,
    roleRegistry,
  });
  const runtime: Runtime = {
    runtimeId,
    taskState,
    workflow,
    projectConfig,
    eventEmitter,
    eventLogger,
    artifactManager,
    roleRegistry,
  };
  const persistedContext: PersistedTaskContext = {
    ...input.persistedContext,
    lastRuntimeId: runtimeId,
    projectConfig,
  };

  await artifactManager.saveTaskContext(persistedContext);

  return {
    runtime,
    persistedContext,
    capabilityWarnings: [
      "Runtime 已根据持久化快照重建，没有复用上一次内存实例。",
      "RoleRegistry 会在当前 Runtime 内懒创建角色实例；默认角色执行会进入统一 Agent 调用链。",
    ],
  };
}

export async function findLatestPersistedTask(
  artifactDir: string,
): Promise<PersistedTaskContext | null> {
  const projectConfig = createArtifactLookupProjectConfig(artifactDir);
  const artifactManager = new FileArtifactManager(projectConfig);
  const taskId = await artifactManager.findLatestResumableTaskId();

  if (!taskId) {
    return null;
  }

  return loadPersistedTaskById(artifactDir, taskId);
}

export async function loadPersistedTaskById(
  artifactDir: string,
  taskId: string,
): Promise<PersistedTaskContext | null> {
  const projectConfig = createArtifactLookupProjectConfig(artifactDir);
  const artifactManager = new FileArtifactManager(projectConfig);

  try {
    const taskState = await artifactManager.loadTaskState(taskId);

    if (taskState.status === "completed" || taskState.status === "failed") {
      return null;
    }

    return artifactManager.loadTaskContext(taskId);
  } catch {
    return null;
  }
}

async function validateRuntimeInput(
  projectDir: string,
  artifactDir: string,
  workflow: WorkflowSelection,
  workflowPhases?: WorkflowPhaseConfig[],
): Promise<void> {
  const resolvedProjectDir = path.resolve(projectDir);
  const resolvedArtifactDir = path.resolve(artifactDir);
  const projectStats = await fs.stat(resolvedProjectDir).catch(() => null);

  if (!projectStats || !projectStats.isDirectory()) {
    throw new Error(`Project directory is not accessible: ${resolvedProjectDir}`);
  }

  if (!workflow?.id || !workflow?.name || !workflow?.label || !workflow?.description) {
    throw new Error("Workflow configuration is missing or invalid.");
  }

  if (!workflowPhases || workflowPhases.length === 0) {
    throw new Error("Workflow phases are missing or invalid.");
  }

  // 这里提前校验 phase 结构，避免 Runtime 启动后才在 Workflow 内部暴露配置缺口。
  for (const phaseConfig of workflowPhases) {
    if (!phaseConfig.name || !phaseConfig.hostRole) {
      throw new Error("Workflow phase config is missing required fields.");
    }
  }

  await fs.mkdir(resolvedArtifactDir, { recursive: true });
}

async function createNextTaskId(
  artifactDir: string,
  title: string,
  now: Date = new Date(),
): Promise<string> {
  const tasksRoot = path.join(path.resolve(artifactDir), "tasks");
  let maxSequence = 0;

  try {
    const entries = await fs.readdir(tasksRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const matched = entry.name.match(/^task_\d{8}_(\d+)-/);

      if (!matched) {
        continue;
      }

      const sequence = Number(matched[1]);

      if (Number.isFinite(sequence) && sequence > maxSequence) {
        maxSequence = sequence;
      }
    }
  } catch {
    // 首次运行时 tasks 目录可能还不存在，直接从 001 开始即可。
  }

  return createTaskId(title, now, maxSequence + 1);
}

function createArtifactLookupProjectConfig(artifactDir: string): ProjectConfig {
  return createProjectConfig({
    projectDir: path.dirname(artifactDir),
    artifactDir,
    workflow: createWorkflowSelection("feature_change"),
  });
}

async function resolveProjectRoleExecutorConfig(
  projectDir: string,
): Promise<ProjectRoleExecutorOverride | undefined> {
  const yamlOverride = await loadProjectRoleExecutorConfig(projectDir);

  if (!yamlOverride) {
    return undefined;
  }

  return yamlOverride;
}

export { loadProjectWorkflowCatalog };

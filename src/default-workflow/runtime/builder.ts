import { promises as fs } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { FileArtifactManager } from "../persistence/task-store";
import {
  createInitialTaskState,
  createProjectConfig,
  createRuntimeId,
  createTaskId,
  createTaskTitle,
} from "../shared/utils";
import type {
  PersistedTaskContext,
  ProjectConfig,
  Runtime,
  WorkflowOrchestration,
  WorkflowSelection,
} from "../shared/types";
import { JsonlEventLogger, StaticRoleRegistry } from "./dependencies";
import { DefaultWorkflowController } from "../workflow/controller";

export interface BuildNewRuntimeInput {
  projectDir: string;
  artifactDir: string;
  workflow: WorkflowSelection;
  orchestration: WorkflowOrchestration;
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
    input.orchestration,
  );

  // Runtime 装配顺序遵循实现计划：先配置，再基础设施，最后控制器。
  const runtimeId = createRuntimeId();
  const title = createTaskTitle(
    input.description,
    `${input.workflow.taskType}_task`,
  );
  const taskId = createTaskId(title);
  const projectConfig = createProjectConfig({
    projectDir: input.projectDir,
    artifactDir: input.artifactDir,
    workflow: input.workflow,
    orchestration: input.orchestration,
  });
  const eventEmitter = new EventEmitter();
  const eventLogger = new JsonlEventLogger(
    path.join(projectConfig.artifactDir, "workflow-events.jsonl"),
  );
  const artifactManager = new FileArtifactManager(projectConfig);
  const roleRegistry = new StaticRoleRegistry();
  const taskState = createInitialTaskState(taskId, title);
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
    projectConfig,
  };

  await artifactManager.initializeTask(taskId);
  await artifactManager.saveTaskContext(persistedContext);
  await artifactManager.saveTaskState(taskState);

  return {
    runtime,
    persistedContext,
    capabilityWarnings: [
      "RoleRegistry 使用受控占位实现，当前仅注册 Clarifier 占位角色。",
      "WorkflowController 只实现 Intake 验收闭环，不承担完整 phase 执行。",
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
    input.projectConfig.orchestration,
  );

  // 恢复时始终基于持久化工件重建全新的 Runtime，
  // 而不是复用上一次进程里的控制器或事件对象。
  const runtimeId = createRuntimeId();
  const projectConfig = createProjectConfig(input.projectConfig);
  const eventEmitter = new EventEmitter();
  const eventLogger = new JsonlEventLogger(
    path.join(projectConfig.artifactDir, "workflow-events.jsonl"),
  );
  const artifactManager = new FileArtifactManager(projectConfig);
  const roleRegistry = new StaticRoleRegistry();
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
  };

  await artifactManager.saveTaskContext(persistedContext);

  return {
    runtime,
    persistedContext,
    capabilityWarnings: [
      "Runtime 已从持久化快照重建，未复用上一次内存实例。",
      "RoleRegistry 与下游角色执行仍为受控占位实现。",
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

    // 已完成和已失败的任务不应该进入恢复链路。
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
  orchestration?: WorkflowOrchestration,
): Promise<void> {
  const resolvedProjectDir = path.resolve(projectDir);
  const resolvedArtifactDir = path.resolve(artifactDir);

  const projectStats = await fs.stat(resolvedProjectDir).catch(() => null);

  if (!projectStats || !projectStats.isDirectory()) {
    throw new Error(`Project directory is not accessible: ${resolvedProjectDir}`);
  }

  if (!workflow?.id || !workflow?.taskType || !workflow?.label) {
    throw new Error("Workflow configuration is missing or invalid.");
  }

  if (!orchestration?.profileId || orchestration.phases.length === 0) {
    throw new Error("Workflow orchestration is missing or invalid.");
  }

  // 校验阶段允许预先创建工件目录，因为任务启动前必须确认该路径可写。
  await fs.mkdir(resolvedArtifactDir, { recursive: true });
}

function createArtifactLookupProjectConfig(artifactDir: string): ProjectConfig {
  return createProjectConfig({
    projectDir: path.dirname(artifactDir),
    artifactDir,
    workflow: {
      id: "default-workflow",
      taskType: "feature_change",
      label: "Feature Change",
    },
    orchestration: {
      profileId: "default-v0.1",
      label: "default-workflow/v0.1",
      phases: [
        "clarify",
        "explore",
        "plan",
        "build",
        "critic",
        "test_design",
        "test",
      ],
      resumePolicy: "rebuild_runtime",
      approvalMode: "human_in_the_loop",
    },
  });
}

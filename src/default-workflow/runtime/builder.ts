import { promises as fs } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { FileArtifactManager } from "../persistence/task-store";
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
  RoleExecutorConfig,
  Runtime,
  WorkflowPhaseConfig,
  WorkflowSelection,
} from "../shared/types";
import { DefaultRoleRegistry, JsonlEventLogger } from "./dependencies";

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

type PartialRoleExecutorConfig = {
  transport?: Partial<RoleExecutorConfig["transport"]>;
  provider?: Partial<RoleExecutorConfig["provider"]>;
};

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
    `${input.workflow.taskType}_task`,
  );
  const taskId = createTaskId(title);
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
  const eventLogger = new JsonlEventLogger(
    path.join(projectConfig.artifactDir, "workflow-events.jsonl"),
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
  const eventLogger = new JsonlEventLogger(
    path.join(projectConfig.artifactDir, "workflow-events.jsonl"),
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

  if (!workflow?.id || !workflow?.taskType || !workflow?.label) {
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

function createArtifactLookupProjectConfig(artifactDir: string): ProjectConfig {
  return createProjectConfig({
    projectDir: path.dirname(artifactDir),
    artifactDir,
    workflow: createWorkflowSelection("feature_change"),
  });
}

async function resolveProjectRoleExecutorConfig(
  projectDir: string,
): Promise<PartialRoleExecutorConfig | undefined> {
  const yamlOverride = await loadRoleExecutorConfigFromYaml(projectDir);

  if (!yamlOverride) {
    return undefined;
  }

  return yamlOverride;
}

async function loadRoleExecutorConfigFromYaml(
  projectDir: string,
): Promise<PartialRoleExecutorConfig | undefined> {
  const configPath = path.join(
    path.resolve(projectDir),
    ".aegisflow",
    "aegisproject.yaml",
  );

  try {
    const content = await fs.readFile(configPath, "utf8");
    return parseRoleExecutorConfig(content);
  } catch {
    return undefined;
  }
}

function parseRoleExecutorConfig(
  content: string,
): PartialRoleExecutorConfig | undefined {
  const result: PartialRoleExecutorConfig = {};
  let inRolesBlock = false;
  let inExecutorBlock = false;
  let executorChildBlock: "transport" | "provider" | undefined;
  let inTransportEnvBlock = false;

  for (const rawLine of content.split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const indent = getYamlIndent(rawLine);

    if (indent === 0) {
      inRolesBlock = trimmedLine === "roles:";
      inExecutorBlock = false;
      executorChildBlock = undefined;
      inTransportEnvBlock = false;
      continue;
    }

    if (!inRolesBlock) {
      continue;
    }

    if (indent === 2) {
      executorChildBlock = undefined;
      inTransportEnvBlock = false;
      inExecutorBlock = trimmedLine === "executor:";
      continue;
    }

    if (!inExecutorBlock) {
      continue;
    }

    if (indent === 4) {
      executorChildBlock = undefined;
      inTransportEnvBlock = false;

      if (trimmedLine === "transport:") {
        executorChildBlock = "transport";
        result.transport = {
          type: "child_process",
          ...(result.transport ?? {}),
        };
        continue;
      }

      if (trimmedLine === "provider:") {
        executorChildBlock = "provider";
        result.provider = {
          type: "codex",
          ...(result.provider ?? {}),
        };
        continue;
      }

      const keyValue = splitYamlKeyValue(trimmedLine);

      if (!keyValue) {
        continue;
      }

      const value = parseYamlScalar(keyValue.value);

      switch (keyValue.key) {
        case "command":
          if (typeof value === "string") {
            result.provider = {
              type: "codex",
              ...(result.provider ?? {}),
              command: value,
            };
          }
          break;
        case "cwd":
          if (typeof value === "string") {
            result.transport = {
              type: "child_process",
              ...(result.transport ?? {}),
              cwd: value,
            };
          }
          break;
        case "timeoutMs":
          if (typeof value === "number") {
            result.transport = {
              type: "child_process",
              ...(result.transport ?? {}),
              timeoutMs: value,
            };
          }
          break;
        default:
          break;
      }

      continue;
    }

    if (indent === 6 && executorChildBlock === "transport") {
      inTransportEnvBlock = trimmedLine === "env:";

      if (inTransportEnvBlock) {
        continue;
      }

      const keyValue = splitYamlKeyValue(trimmedLine);

      if (!keyValue) {
        continue;
      }

      const value = parseYamlScalar(keyValue.value);

      switch (keyValue.key) {
        case "type":
          if (value === "child_process") {
            result.transport = {
              type: "child_process",
              ...(result.transport ?? {}),
            };
          }
          break;
        case "cwd":
          if (typeof value === "string") {
            result.transport = {
              type: "child_process",
              ...(result.transport ?? {}),
              cwd: value,
            };
          }
          break;
        case "timeoutMs":
          if (typeof value === "number") {
            result.transport = {
              type: "child_process",
              ...(result.transport ?? {}),
              timeoutMs: value,
            };
          }
          break;
        default:
          break;
      }

      continue;
    }

    if (indent === 6 && executorChildBlock === "provider") {
      const keyValue = splitYamlKeyValue(trimmedLine);

      if (!keyValue) {
        continue;
      }

      const value = parseYamlScalar(keyValue.value);

      switch (keyValue.key) {
        case "type":
          if (value === "codex") {
            result.provider = {
              type: "codex",
              ...(result.provider ?? {}),
            };
          }
          break;
        case "command":
          if (typeof value === "string") {
            result.provider = {
              type: "codex",
              ...(result.provider ?? {}),
              command: value,
            };
          }
          break;
        default:
          break;
      }

      continue;
    }

    if (inTransportEnvBlock && indent === 8) {
      const keyValue = splitYamlKeyValue(trimmedLine);

      if (!keyValue) {
        continue;
      }

      const value = parseYamlScalar(keyValue.value);

      if (keyValue.key === "passthrough" && typeof value === "boolean") {
        result.transport = {
          type: "child_process",
          ...(result.transport ?? {}),
          env: {
            ...(result.transport?.env ?? {}),
            passthrough: value,
          },
        };
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function getYamlIndent(line: string): number {
  let indent = 0;

  while (indent < line.length && line[indent] === " ") {
    indent += 1;
  }

  return indent;
}

function splitYamlKeyValue(
  line: string,
): { key: string; value: string } | null {
  const separatorIndex = line.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  return {
    key: line.slice(0, separatorIndex).trim(),
    value: line.slice(separatorIndex + 1).trim(),
  };
}

function parseYamlScalar(value: string): string | number | boolean | undefined {
  const normalized = value.replace(/\s+#.*$/u, "").trim();

  if (!normalized) {
    return undefined;
  }

  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    return normalized.slice(1, -1);
  }

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  if (/^-?\d+$/u.test(normalized)) {
    return Number(normalized);
  }

  return normalized;
}

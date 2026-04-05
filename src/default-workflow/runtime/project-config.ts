import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_PHASE_ROLE_MAPPING,
  PROJECT_CONFIG_RELATIVE_PATH,
} from "../shared/constants";
import type {
  ProjectWorkflowCatalog,
  ProjectWorkflowDefinition,
  RoleExecutorConfig,
  WorkflowPhaseConfig,
} from "../shared/types";

export type ProjectRoleExecutorOverride = {
  transport?: Partial<RoleExecutorConfig["transport"]>;
  provider?: Partial<RoleExecutorConfig["provider"]>;
};

interface MutableWorkflowDefinition {
  name?: string;
  description?: string;
  phases: MutableWorkflowPhase[];
}

interface MutableWorkflowPhase {
  name?: string;
  hostRole?: string;
  needApproval?: boolean;
  pauseForInput?: boolean;
  artifactInputPhases?: unknown;
}

const VALID_PHASE_NAMES = new Set<WorkflowPhaseConfig["name"]>(
  Object.keys(DEFAULT_PHASE_ROLE_MAPPING) as WorkflowPhaseConfig["name"][],
);
const VALID_ROLE_NAMES = new Set<WorkflowPhaseConfig["hostRole"]>(
  Object.values(DEFAULT_PHASE_ROLE_MAPPING),
);

export async function loadProjectWorkflowCatalog(
  projectDir: string,
): Promise<ProjectWorkflowCatalog> {
  const configPath = resolveProjectConfigPath(projectDir);
  const content = await readProjectConfigContent(configPath);

  return parseProjectWorkflowCatalog(content, configPath);
}

export async function loadProjectRoleExecutorConfig(
  projectDir: string,
): Promise<ProjectRoleExecutorOverride | undefined> {
  const configPath = resolveProjectConfigPath(projectDir);

  try {
    const content = await fs.readFile(configPath, "utf8");
    return parseProjectRoleExecutorConfig(content);
  } catch {
    return undefined;
  }
}

function resolveProjectConfigPath(projectDir: string): string {
  return path.join(path.resolve(projectDir), PROJECT_CONFIG_RELATIVE_PATH);
}

async function readProjectConfigContent(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, "utf8");
  } catch {
    throw new Error(
      `未找到项目配置文件：${configPath}。请先修正 .aegisflow/aegisproject.yaml。`,
    );
  }
}

function parseProjectWorkflowCatalog(
  content: string,
  configPath: string,
): ProjectWorkflowCatalog {
  const workflows: MutableWorkflowDefinition[] = [];
  let inWorkflowsBlock = false;
  let inPhasesBlock = false;
  let sawSingularWorkflowBlock = false;
  let currentWorkflow: MutableWorkflowDefinition | undefined;
  let currentPhase: MutableWorkflowPhase | undefined;
  let activePhaseListField: "artifactInputPhases" | undefined;

  const finalizePhase = (): void => {
    if (!currentWorkflow || !currentPhase) {
      return;
    }

    activePhaseListField = undefined;
    currentWorkflow.phases.push(currentPhase);
    currentPhase = undefined;
  };

  const finalizeWorkflow = (): void => {
    if (!currentWorkflow) {
      return;
    }

    finalizePhase();
    workflows.push(currentWorkflow);
    currentWorkflow = undefined;
    inPhasesBlock = false;
  };

  for (const rawLine of content.split(/\r?\n/u)) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const indent = getYamlIndent(rawLine);

    if (indent === 0) {
      finalizeWorkflow();
      inWorkflowsBlock = trimmedLine === "workflows:";
      sawSingularWorkflowBlock ||= trimmedLine === "workflow:";
      activePhaseListField = undefined;
      continue;
    }

    if (!inWorkflowsBlock) {
      continue;
    }

    if (indent === 2) {
      finalizeWorkflow();
      activePhaseListField = undefined;

      if (!trimmedLine.startsWith("-")) {
        continue;
      }

      currentWorkflow = {
        phases: [],
      };

      const inlineContent = trimmedLine.slice(1).trim();

      if (inlineContent.length > 0) {
        const keyValue = splitYamlKeyValue(inlineContent);

        if (keyValue) {
          assignWorkflowField(currentWorkflow, keyValue.key, keyValue.value);
        }
      }

      continue;
    }

    if (!currentWorkflow) {
      continue;
    }

    if (indent === 4) {
      finalizePhase();
      inPhasesBlock = trimmedLine === "phases:";
      activePhaseListField = undefined;

      if (!inPhasesBlock) {
        const keyValue = splitYamlKeyValue(trimmedLine);

        if (keyValue) {
          assignWorkflowField(currentWorkflow, keyValue.key, keyValue.value);
        }
      }

      continue;
    }

    if (inPhasesBlock && indent === 6) {
      finalizePhase();
      activePhaseListField = undefined;

      if (!trimmedLine.startsWith("-")) {
        continue;
      }

      currentPhase = {};
      const inlineContent = trimmedLine.slice(1).trim();

      if (inlineContent.length > 0) {
        const keyValue = splitYamlKeyValue(inlineContent);

        if (keyValue) {
          assignPhaseField(currentPhase, keyValue.key, keyValue.value);
        }
      }

      continue;
    }

    if (inPhasesBlock && indent === 8 && currentPhase) {
      activePhaseListField = undefined;
      const keyValue = splitYamlKeyValue(trimmedLine);

      if (keyValue) {
        assignPhaseField(currentPhase, keyValue.key, keyValue.value);

        if (
          keyValue.key === "artifactInputPhases" &&
          keyValue.value.replace(/\s+#.*$/u, "").trim().length === 0
        ) {
          currentPhase.artifactInputPhases = [];
          activePhaseListField = "artifactInputPhases";
        }
      }
    }

    if (
      inPhasesBlock &&
      indent === 10 &&
      currentPhase &&
      activePhaseListField === "artifactInputPhases" &&
      trimmedLine.startsWith("-")
    ) {
      const itemValue = parseYamlScalar(trimmedLine.slice(1).trim());

      if (!Array.isArray(currentPhase.artifactInputPhases)) {
        currentPhase.artifactInputPhases = [];
      }

      (currentPhase.artifactInputPhases as unknown[]).push(itemValue);
      continue;
    }
  }

  finalizeWorkflow();

  if (workflows.length === 0) {
    const reason = sawSingularWorkflowBlock
      ? "当前仍使用旧的 workflow 单对象结构；本期必须改为 workflows 非空列表。"
      : "缺少 workflows 非空列表。";
    throw createWorkflowConfigError(configPath, reason);
  }

  const workflowNames = new Set<string>();

  return {
    configPath,
    workflows: workflows.map((workflow, index) =>
      validateWorkflowDefinition(workflow, index, configPath, workflowNames),
    ),
  };
}

function validateWorkflowDefinition(
  workflow: MutableWorkflowDefinition,
  index: number,
  configPath: string,
  workflowNames: Set<string>,
): ProjectWorkflowDefinition {
  const name = workflow.name?.trim();

  if (!name) {
    throw createWorkflowConfigError(
      configPath,
      `workflows[${index}].name 不能为空。`,
    );
  }

  if (workflowNames.has(name)) {
    throw createWorkflowConfigError(
      configPath,
      `workflows[${index}].name 重复：${name}。`,
    );
  }

  workflowNames.add(name);

  const description = workflow.description?.trim();

  if (!description) {
    throw createWorkflowConfigError(
      configPath,
      `workflows[${index}].description 不能为空。`,
    );
  }

  if (workflow.phases.length === 0) {
    throw createWorkflowConfigError(
      configPath,
      `workflows[${index}].phases 必须是非空列表。`,
    );
  }

  const phaseNames = new Set<WorkflowPhaseConfig["name"]>();
  const phases = workflow.phases.map((phase, phaseIndex) =>
    validateWorkflowPhase(name, phase, phaseIndex, configPath, phaseNames),
  );
  const phaseNameSet = new Set(phases.map((phase) => phase.name));

  for (const [phaseIndex, phase] of phases.entries()) {
    const artifactInputPhases = phase.artifactInputPhases ?? [];
    const upstreamPhases = new Set(
      phases.slice(0, phaseIndex).map((item) => item.name),
    );

    for (const inputPhase of artifactInputPhases) {
      if (!phaseNameSet.has(inputPhase)) {
        throw createWorkflowConfigError(
          configPath,
          `workflow ${name} 的 phases[${phaseIndex}].artifactInputPhases 引用了未定义阶段：${inputPhase}。`,
        );
      }

      if (!upstreamPhases.has(inputPhase)) {
        throw createWorkflowConfigError(
          configPath,
          `workflow ${name} 的 phases[${phaseIndex}].artifactInputPhases 只能引用当前阶段之前的上游阶段：${inputPhase}。`,
        );
      }
    }
  }

  return {
    name,
    description,
    phases,
  };
}

function validateWorkflowPhase(
  workflowName: string,
  phase: MutableWorkflowPhase,
  phaseIndex: number,
  configPath: string,
  phaseNames: Set<WorkflowPhaseConfig["name"]>,
): WorkflowPhaseConfig {
  const rawPhaseName = phase.name;
  const rawHostRole = phase.hostRole;

  if (
    typeof rawPhaseName !== "string" ||
    !VALID_PHASE_NAMES.has(rawPhaseName as WorkflowPhaseConfig["name"])
  ) {
    throw createWorkflowConfigError(
      configPath,
      `workflow ${workflowName} 的 phases[${phaseIndex}].name 非法。`,
    );
  }

  if (
    typeof rawHostRole !== "string" ||
    !VALID_ROLE_NAMES.has(rawHostRole as WorkflowPhaseConfig["hostRole"])
  ) {
    throw createWorkflowConfigError(
      configPath,
      `workflow ${workflowName} 的 phases[${phaseIndex}].hostRole 非法。`,
    );
  }

  if (typeof phase.needApproval !== "boolean") {
    throw createWorkflowConfigError(
      configPath,
      `workflow ${workflowName} 的 phases[${phaseIndex}].needApproval 必须是布尔值。`,
    );
  }

  const phaseName = rawPhaseName as WorkflowPhaseConfig["name"];
  const hostRole = rawHostRole as WorkflowPhaseConfig["hostRole"];

  if (phaseNames.has(phaseName)) {
    throw createWorkflowConfigError(
      configPath,
      `workflow ${workflowName} 的 phases[${phaseIndex}].name 重复：${phaseName}。`,
    );
  }

  phaseNames.add(phaseName);

  if (
    phase.artifactInputPhases !== undefined &&
    !Array.isArray(phase.artifactInputPhases)
  ) {
    throw createWorkflowConfigError(
      configPath,
      `workflow ${workflowName} 的 phases[${phaseIndex}].artifactInputPhases 必须是 phase 名数组。`,
    );
  }

  const artifactInputPhases = Array.isArray(phase.artifactInputPhases)
    ? phase.artifactInputPhases.map((item) => {
        if (
          typeof item !== "string" ||
          !VALID_PHASE_NAMES.has(item as WorkflowPhaseConfig["name"])
        ) {
          throw createWorkflowConfigError(
            configPath,
            `workflow ${workflowName} 的 phases[${phaseIndex}].artifactInputPhases 包含非法阶段名：${String(item)}。`,
          );
        }

        return item as WorkflowPhaseConfig["name"];
      })
    : undefined;

  return {
    name: phaseName,
    hostRole,
    needApproval: phase.needApproval,
    pauseForInput: phase.pauseForInput,
    ...(artifactInputPhases !== undefined
      ? { artifactInputPhases }
      : {}),
  };
}

function assignWorkflowField(
  workflow: MutableWorkflowDefinition,
  key: string,
  rawValue: string,
): void {
  const value = parseYamlScalar(rawValue);

  if (key === "name" && typeof value === "string") {
    workflow.name = value;
  }

  if (key === "description" && typeof value === "string") {
    workflow.description = value;
  }
}

function assignPhaseField(
  phase: MutableWorkflowPhase,
  key: string,
  rawValue: string,
): void {
  const value = parseYamlScalar(rawValue);

  switch (key) {
    case "name":
      if (typeof value === "string") {
        phase.name = value as WorkflowPhaseConfig["name"];
      }
      break;
    case "hostRole":
      if (typeof value === "string") {
        phase.hostRole = value as WorkflowPhaseConfig["hostRole"];
      }
      break;
    case "needApproval":
      if (typeof value === "boolean") {
        phase.needApproval = value;
      }
      break;
    case "pauseForInput":
      if (typeof value === "boolean") {
        phase.pauseForInput = value;
      }
      break;
    case "artifactInputPhases":
      phase.artifactInputPhases = value;
      break;
    default:
      break;
  }
}

function createWorkflowConfigError(configPath: string, reason: string): Error {
  return new Error(
    `项目 workflow 配置非法：${reason} 请修正 ${configPath} 中的 workflows 配置。`,
  );
}

function parseProjectRoleExecutorConfig(
  content: string,
): ProjectRoleExecutorOverride | undefined {
  const result: ProjectRoleExecutorOverride = {};
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

function parseYamlScalar(
  value: string,
): string | number | boolean | string[] | undefined {
  const normalized = value.replace(/\s+#.*$/u, "").trim();

  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    return parseYamlInlineArray(normalized);
  }

  const unquoted =
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
      ? normalized.slice(1, -1)
      : normalized;

  if (unquoted === "true") {
    return true;
  }

  if (unquoted === "false") {
    return false;
  }

  if (/^-?\d+$/u.test(unquoted)) {
    return Number(unquoted);
  }

  return unquoted;
}

function parseYamlInlineArray(value: string): string[] {
  const content = value.slice(1, -1).trim();

  if (content.length === 0) {
    return [];
  }

  return content
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const parsed = parseYamlScalar(item);

      return typeof parsed === "string" ? parsed : String(parsed);
    });
}

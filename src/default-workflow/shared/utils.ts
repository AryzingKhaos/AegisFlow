import path from "node:path";
import {
  DEFAULT_ARTIFACT_DIR_NAME,
  DEFAULT_WORKFLOW_ID,
  DEFAULT_WORKFLOW_PHASES,
  DEFAULT_WORKFLOW_PROFILE_ID,
  DEFAULT_WORKFLOW_PROFILE_LABEL,
  SUPPORTED_WORKFLOW_TYPES,
} from "./constants";
import type {
  ProjectConfig,
  TaskState,
  WorkflowPhaseConfig,
  WorkflowSelection,
  WorkflowTaskType,
} from "./types";
import { TaskStatus } from "./types";

export function createRuntimeId(now: number = Date.now()): string {
  return `runtime_${now.toString(36)}`;
}

export function createTaskId(
  title: string,
  now: Date = new Date(),
  sequence: number = Math.floor(now.getTime() % 1000),
): string {
  const datePart = [
    now.getFullYear().toString().padStart(4, "0"),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
  ].join("");
  const safeSequence = sequence.toString().padStart(3, "0");

  return `task_${datePart}_${safeSequence}-${title}`;
}

export function createTaskTitle(
  description: string,
  fallback: string = "default_workflow_task",
): string {
  const normalized = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("_");

  if (normalized.length > 0) {
    return normalized;
  }

  return fallback;
}

export function createWorkflowSelection(
  taskType: WorkflowTaskType,
): WorkflowSelection {
  return {
    id: DEFAULT_WORKFLOW_ID,
    taskType,
    label: SUPPORTED_WORKFLOW_TYPES[taskType].label,
  };
}

export function createDefaultWorkflowPhases(): WorkflowPhaseConfig[] {
  return DEFAULT_WORKFLOW_PHASES.map((phaseConfig) => ({ ...phaseConfig }));
}

export function createInitialTaskState(
  taskId: string,
  title: string,
  workflowPhases: WorkflowPhaseConfig[],
): TaskState {
  return {
    taskId,
    title,
    currentPhase: workflowPhases[0].name,
    phaseStatus: "pending",
    status: TaskStatus.IDLE,
    updatedAt: Date.now(),
  };
}

export function resolveArtifactDir(
  projectDir: string,
  artifactInput?: string,
): string {
  if (artifactInput && artifactInput.trim().length > 0) {
    return path.resolve(projectDir, artifactInput.trim());
  }

  return path.resolve(projectDir, DEFAULT_ARTIFACT_DIR_NAME);
}

export function createProjectConfig(input: {
  projectDir: string;
  artifactDir: string;
  workflow: WorkflowSelection;
  workflowPhases?: WorkflowPhaseConfig[];
  workflowProfileId?: string;
  workflowProfileLabel?: string;
}): ProjectConfig {
  return {
    projectDir: path.resolve(input.projectDir),
    artifactDir: path.resolve(input.artifactDir),
    workflow: input.workflow,
    workflowProfileId: input.workflowProfileId ?? DEFAULT_WORKFLOW_PROFILE_ID,
    workflowProfileLabel:
      input.workflowProfileLabel ?? DEFAULT_WORKFLOW_PROFILE_LABEL,
    workflowPhases: (input.workflowPhases ?? createDefaultWorkflowPhases()).map(
      (phaseConfig) => ({
        ...phaseConfig,
      }),
    ),
    resumePolicy: "rebuild_runtime",
    approvalMode: "human_in_the_loop",
  };
}

export function formatWorkflowPhases(phases: WorkflowPhaseConfig[]): string {
  return phases.map((phaseConfig) => phaseConfig.name).join(" -> ");
}

export function formatTaskStateSummary(taskState: TaskState): string {
  const parts = [
    `currentPhase=${taskState.currentPhase}`,
    `status=${taskState.status}`,
    `phaseStatus=${taskState.phaseStatus}`,
  ];

  if (taskState.resumeFrom) {
    const step = taskState.resumeFrom.currentStep
      ? `/${taskState.resumeFrom.currentStep}`
      : "";
    parts.push(
      `resumeFrom=${taskState.resumeFrom.phase}:${taskState.resumeFrom.roleName}${step}`,
    );
  }

  return parts.join(", ");
}

export function isTruthyAnswer(input: string): boolean {
  return /^(y|yes|是|对|正确|确认|ok)$/i.test(input.trim());
}

export function isFalsyAnswer(input: string): boolean {
  return /^(n|no|否|不对|不正确|不是)$/i.test(input.trim());
}

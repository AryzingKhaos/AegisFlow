import type { EventEmitter } from "node:events";

export type WorkflowTaskType =
  | "feature_change"
  | "bugfix"
  | "small_new_feature";

export type WorkflowName = "default-workflow";

export type Phase =
  | "intake"
  | "clarify"
  | "explore"
  | "plan"
  | "build"
  | "critic"
  | "test_design"
  | "test";

export type PhaseStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export enum TaskStatus {
  IDLE = "idle",
  RUNNING = "running",
  WAITING_USER_INPUT = "waiting_user_input",
  WAITING_APPROVAL = "waiting_approval",
  INTERRUPTED = "interrupted",
  FAILED = "failed",
  COMPLETED = "completed",
}

export interface ResumePoint {
  phase: Phase;
  roleName: string;
  currentStep?: string;
}

export interface TaskState {
  taskId: string;
  title: string;
  currentPhase: Phase;
  phaseStatus: PhaseStatus;
  status: TaskStatus;
  resumeFrom?: ResumePoint;
  updatedAt: number;
}

export interface WorkflowSelection {
  id: WorkflowName;
  taskType: WorkflowTaskType;
  label: string;
}

export interface ProjectConfig {
  projectDir: string;
  artifactDir: string;
  workflow: WorkflowSelection;
}

export type IntakeEventType =
  | "init_task"
  | "start_task"
  | "cancel_task"
  | "interrupt_task"
  | "resume_task"
  | "participate";

export interface IntakeEvent {
  type: IntakeEventType;
  taskId: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type WorkflowEventType =
  | "task_start"
  | "task_end"
  | "phase_start"
  | "phase_end"
  | "role_start"
  | "role_end"
  | "artifact_created"
  | "progress"
  | "error";

export interface WorkflowEvent {
  type: WorkflowEventType;
  taskId: string;
  message: string;
  timestamp: number;
  taskState: TaskState;
  metadata?: Record<string, unknown>;
}

export interface PersistedTaskContext {
  taskId: string;
  title: string;
  description: string;
  createdAt: number;
  lastRuntimeId: string;
  projectConfig: ProjectConfig;
}

export interface EventLogger {
  append(event: WorkflowEvent): Promise<void>;
}

export interface ArtifactManager {
  initializeTask(taskId: string): Promise<void>;
  saveTaskState(taskState: TaskState): Promise<string>;
  saveTaskContext(context: PersistedTaskContext): Promise<string>;
  loadTaskState(taskId: string): Promise<TaskState>;
  loadTaskContext(taskId: string): Promise<PersistedTaskContext>;
  findLatestResumableTaskId(): Promise<string | null>;
}

export interface RoleDescriptor {
  name: string;
  description: string;
  placeholder: boolean;
}

export interface RoleRegistry {
  list(): RoleDescriptor[];
}

export interface Runtime {
  runtimeId: string;
  taskState: TaskState;
  workflow: WorkflowController;
  projectConfig: ProjectConfig;
  eventEmitter: EventEmitter;
  eventLogger: EventLogger;
  artifactManager: ArtifactManager;
  roleRegistry: RoleRegistry;
}

export interface WorkflowController {
  handleIntakeEvent(event: IntakeEvent): Promise<WorkflowEvent[]>;
}


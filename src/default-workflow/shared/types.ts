import type { EventEmitter } from "node:events";

export type WorkflowTaskType =
  | "feature_change"
  | "bugfix"
  | "small_new_feature";

export type WorkflowName = "default-workflow";

export type Phase =
  | "clarify"
  | "explore"
  | "plan"
  | "build"
  | "review"
  | "test-design"
  | "unit-test"
  | "test";

export type RoleName =
  | "clarifier"
  | "explorer"
  | "planner"
  | "builder"
  | "critic"
  | "test-designer"
  | "test-writer"
  | "tester";

export type PhaseStatus = "pending" | "running" | "done";

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
  roleName: RoleName;
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

export interface WorkflowPhaseConfig {
  name: Phase;
  hostRole: RoleName;
  needApproval: boolean;
  pauseForInput?: boolean;
}

export interface ProjectConfig {
  projectDir: string;
  artifactDir: string;
  targetProjectRolePromptPath: string;
  rolePromptOverrides: Partial<Record<RoleName, string>>;
  workflow: WorkflowSelection;
  workflowProfileId: string;
  workflowProfileLabel: string;
  workflowPhases: WorkflowPhaseConfig[];
  resumePolicy: "rebuild_runtime";
  approvalMode: "human_in_the_loop";
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
  latestInput?: string;
  projectConfig: ProjectConfig;
}

export interface TaskArtifact {
  key: string;
  phase: Phase;
  roleName: RoleName;
  title: string;
  content: string;
}

export interface ArtifactReader {
  get(key: string): Promise<string | undefined>;
  list(phase?: Phase): Promise<string[]>;
}

export interface RoleResult {
  summary: string;
  artifacts: string[];
  metadata?: Record<string, unknown>;
}

export interface RoleCapabilityProfile {
  mode: "analysis" | "delivery" | "verification";
  sideEffects: "forbidden" | "allowed";
  allowedActions: string[];
  focus: string;
}

export interface ExecutionContext {
  taskId: string;
  phase: Phase;
  cwd: string;
  artifacts: ArtifactReader;
  projectConfig: ProjectConfig;
  roleCapabilityProfile: RoleCapabilityProfile;
}

export interface EventLogger {
  append(event: WorkflowEvent): Promise<void>;
}

export interface ArtifactManager {
  initializeTask(taskId: string): Promise<void>;
  saveTaskState(taskState: TaskState): Promise<string>;
  saveTaskContext(context: PersistedTaskContext): Promise<string>;
  saveArtifact(taskId: string, artifact: TaskArtifact): Promise<string>;
  createArtifactReader(taskId: string): ArtifactReader;
  loadTaskState(taskId: string): Promise<TaskState>;
  loadTaskContext(taskId: string): Promise<PersistedTaskContext>;
  findLatestResumableTaskId(): Promise<string | null>;
}

export interface RoleRuntime {
  projectConfig: ProjectConfig;
  eventEmitter: EventEmitter;
  eventLogger: EventLogger;
  roleRegistry: RoleRegistry;
  roleCapabilityProfiles: Readonly<Record<RoleName, RoleCapabilityProfile>>;
}

export interface Role {
  name: RoleName;
  description: string;
  placeholder: boolean;
  capabilityProfile: RoleCapabilityProfile;
  run(input: string, context: ExecutionContext): Promise<RoleResult>;
}

export interface RoleDefinition {
  name: RoleName;
  description?: string;
  create(roleRuntime: RoleRuntime): Role;
}

export interface RoleRegistry {
  register(roleDef: RoleDefinition): void;
  get(name: RoleName): Role;
  list(): string[];
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
  run(taskId: string, input?: string): Promise<WorkflowEvent[]>;
  resume(taskId: string, input?: string): Promise<WorkflowEvent[]>;
  runPhase(phase: Phase, input?: string): Promise<WorkflowEvent[]>;
  runRole(roleName: RoleName, input: string): Promise<RoleResult>;
}

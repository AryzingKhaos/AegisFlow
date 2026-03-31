import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileArtifactManager } from "../persistence/task-store";
import {
  buildRuntimeForNewTask,
  buildRuntimeForResume,
} from "../runtime/builder";
import {
  createDefaultWorkflowPhases,
  createInitialTaskState,
  createProjectConfig,
  createWorkflowSelection,
} from "../shared/utils";
import type {
  EventLogger,
  ExecutionContext,
  Role,
  RoleCapabilityProfile,
  RoleDefinition,
  RoleName,
  RoleRegistry,
  RoleResult,
  WorkflowEvent,
  WorkflowPhaseConfig,
} from "../shared/types";
import { TaskStatus } from "../shared/types";
import { DefaultWorkflowController } from "../workflow/controller";

const tempDirs: string[] = [];

beforeEach(() => {
  process.env.OPENAI_API_KEY = "dummy";
  process.env.AEGISFLOW_ROLE_EXECUTION_MODE = "stub";
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("workflow runtime", () => {
  it("runs phases in configured order and waits for approval at plan", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");
    await mkdir(projectDir, { recursive: true });

    const runtimeResult = await buildRuntimeForNewTask({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: createDefaultWorkflowPhases(),
      description: "修复登录报错",
    });

    const events = await runtimeResult.runtime.workflow.handleIntakeEvent({
      type: "start_task",
      taskId: runtimeResult.runtime.taskState.taskId,
      message: "修复登录报错",
      timestamp: Date.now(),
    });

    expect(runtimeResult.runtime.taskState.status).toBe(
      TaskStatus.WAITING_APPROVAL,
    );
    expect(runtimeResult.runtime.taskState.currentPhase).toBe("plan");
    expect(runtimeResult.runtime.taskState.phaseStatus).toBe("done");
    expect(runtimeResult.runtime.taskState.resumeFrom).toEqual({
      phase: "build",
      roleName: "builder",
      currentStep: "waiting_approval_after_plan",
    });
    expect(
      events
        .filter((event) => event.type === "phase_start")
        .map((event) => event.metadata?.phase),
    ).toEqual(["clarify", "explore", "plan"]);

    const snapshotPath = path.join(
      artifactDir,
      "tasks",
      runtimeResult.runtime.taskState.taskId,
      "task-state.md",
    );
    const snapshot = await readFile(snapshotPath, "utf8");
    expect(snapshot).toContain("status: waiting_approval");
    expect(snapshot).toContain("\"phase\": \"build\"");
  });

  it("rebuilds runtime on resume and continues from the next approved phase", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");
    await mkdir(projectDir, { recursive: true });

    const newRuntimeResult = await buildRuntimeForNewTask({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: createDefaultWorkflowPhases(),
      description: "修复登录报错",
    });

    await newRuntimeResult.runtime.workflow.handleIntakeEvent({
      type: "start_task",
      taskId: newRuntimeResult.runtime.taskState.taskId,
      message: "修复登录报错",
      timestamp: Date.now(),
    });

    const resumedRuntimeResult = await buildRuntimeForResume({
      projectConfig: newRuntimeResult.persistedContext.projectConfig,
      persistedContext: newRuntimeResult.persistedContext,
    });

    const resumeEvents = await resumedRuntimeResult.runtime.workflow.handleIntakeEvent({
      type: "resume_task",
      taskId: resumedRuntimeResult.runtime.taskState.taskId,
      message: "批准继续",
      timestamp: Date.now(),
    });

    expect(resumedRuntimeResult.runtime.runtimeId).not.toBe(
      newRuntimeResult.runtime.runtimeId,
    );
    expect(resumedRuntimeResult.runtime.projectConfig.workflowPhases).toEqual(
      newRuntimeResult.runtime.projectConfig.workflowPhases,
    );
    expect(resumedRuntimeResult.runtime.taskState.status).toBe(
      TaskStatus.WAITING_APPROVAL,
    );
    expect(resumedRuntimeResult.runtime.taskState.currentPhase).toBe("review");
    expect(
      resumeEvents
        .filter((event) => event.type === "phase_start")
        .map((event) => event.metadata?.phase),
    ).toEqual(["build", "review"]);
  });

  it("does not pass approval control text into the next phase role input", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const workflowPhases: WorkflowPhaseConfig[] = [
      {
        name: "plan",
        hostRole: "planner",
        needApproval: true,
      },
      {
        name: "build",
        hostRole: "builder",
        needApproval: false,
      },
    ];
    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_approval_input_case",
      "approval_input_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "真实需求描述",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_approval_input_case",
      projectConfig,
    });

    const observedInputs: string[] = [];
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        planner: createRole("planner", async () => ({
          summary: "planner done",
          artifacts: [],
        })),
        builder: createRole(
          "builder",
          async (input: string, context: ExecutionContext) => {
            observedInputs.push(input);
            expect(await context.artifacts.list()).toEqual([]);

            return {
              summary: "builder done",
              artifacts: [],
            };
          },
        ),
      }),
    });

    await controller.run(taskState.taskId, "真实需求描述");
    await controller.resume(taskState.taskId, "批准继续");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
    expect(observedInputs).toEqual([""]);
  });

  it("forwards role visible output events before role completion", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const workflowPhases: WorkflowPhaseConfig[] = [
      {
        name: "plan",
        hostRole: "planner",
        needApproval: false,
      },
    ];
    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_role_output_case",
      "role_output_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "角色输出透传测试",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_role_output_case",
      projectConfig,
    });

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        planner: createRole("planner", async (_input, context) => {
          await context.emitVisibleOutput?.({
            message: "第一段分析\\n第二段分析",
            kind: "progress",
          });
          await context.emitVisibleOutput?.({
            message: "最终结论：进入实现阶段",
            kind: "summary",
          });

          return {
            summary: "planner done",
            artifacts: [],
          };
        }),
      }),
    });

    const events = await controller.run(taskState.taskId, "角色输出透传测试");
    const eventTypes = events.map((event) => event.type);
    const firstRoleOutputIndex = eventTypes.indexOf("role_output");
    const roleEndIndex = eventTypes.indexOf("role_end");

    expect(firstRoleOutputIndex).toBeGreaterThan(eventTypes.indexOf("role_start"));
    expect(firstRoleOutputIndex).toBeLessThan(roleEndIndex);
    expect(
      events.filter((event) => event.type === "role_output").map((event) => event.message),
    ).toEqual(["第一段分析\\n第二段分析", "最终结论：进入实现阶段"]);
  });

  it("waits for user input on paused phases and resumes from the same phase", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const workflowPhases: WorkflowPhaseConfig[] = [
      {
        name: "clarify",
        hostRole: "clarifier",
        needApproval: false,
        pauseForInput: true,
      },
    ];
    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState("task_pause_case", "pause_case", workflowPhases);
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "补齐 API 细节",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_pause_case",
      projectConfig,
    });

    const logger = new MemoryEventLogger();
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: logger,
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: {
          name: "clarifier",
          description: "clarifier",
          placeholder: false,
          capabilityProfile: createCapabilityProfile("clarifier"),
          async run(input: string, context: ExecutionContext): Promise<RoleResult> {
            return {
              summary: `clarifier:${input}`,
              artifacts: [`# clarify-result\n\nphase=${context.phase}\n\n${input}`],
            };
          },
        },
      }),
    });

    const waitingEvents = await controller.run(taskState.taskId);
    expect(taskState.status).toBe(TaskStatus.WAITING_USER_INPUT);
    expect(taskState.resumeFrom).toEqual({
      phase: "clarify",
      roleName: "clarifier",
      currentStep: "waiting_user_input",
    });
    expect(waitingEvents.some((event) => event.type === "progress")).toBe(true);

    const resumedEvents = await controller.handleIntakeEvent({
      type: "participate",
      taskId: taskState.taskId,
      message: "这里是补充信息",
      timestamp: Date.now(),
    });
    expect(taskState.status).toBe(TaskStatus.COMPLETED);
    expect(
      resumedEvents.some(
        (event) =>
          event.type === "role_end" &&
          event.metadata?.summary === "clarifier:这里是补充信息",
      ),
    ).toBe(true);

    const snapshotPath = path.join(
      artifactDir,
      "tasks",
      taskState.taskId,
      "task-state.md",
    );
    const snapshot = await readFile(snapshotPath, "utf8");
    expect(snapshot).toContain("status: completed");
  });

  it("converges to failed state when role execution throws", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const workflowPhases: WorkflowPhaseConfig[] = [
      {
        name: "clarify",
        hostRole: "clarifier",
        needApproval: false,
      },
    ];
    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState("task_fail_case", "fail_case", workflowPhases);
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "失败用例",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_fail_case",
      projectConfig,
    });

    const logger = new MemoryEventLogger();
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: logger,
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: {
          name: "clarifier",
          description: "clarifier",
          placeholder: false,
          capabilityProfile: createCapabilityProfile("clarifier"),
          async run(): Promise<RoleResult> {
            throw new Error("clarify exploded");
          },
        },
      }),
    });

    const events = await controller.run(taskState.taskId, "失败用例");

    expect(taskState.status).toBe(TaskStatus.FAILED);
    expect(taskState.phaseStatus).toBe("pending");
    expect(events.at(-2)?.type).toBe("error");
    expect(events.at(-1)?.type).toBe("task_end");
    expect(logger.events.some((event) => event.type === "error")).toBe(true);

    const snapshotPath = path.join(
      artifactDir,
      "tasks",
      taskState.taskId,
      "task-state.md",
    );
    const snapshot = await readFile(snapshotPath, "utf8");
    expect(snapshot).toContain("status: failed");
  });

  it("waits for final approval on the last phase before completing", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const workflowPhases: WorkflowPhaseConfig[] = [
      {
        name: "plan",
        hostRole: "planner",
        needApproval: true,
      },
    ];
    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_final_approval_case",
      "final_approval_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "最终审批用例",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_final_approval_case",
      projectConfig,
    });

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        planner: createRole("planner", async () => ({
          summary: "planner done",
          artifacts: [],
        })),
      }),
    });

    await controller.run(taskState.taskId, "最终审批用例");

    expect(taskState.status).toBe(TaskStatus.WAITING_APPROVAL);
    expect(taskState.phaseStatus).toBe("done");
    expect(taskState.resumeFrom).toEqual({
      phase: "plan",
      roleName: "planner",
      currentStep: "waiting_final_approval_after_plan",
    });

    await controller.resume(taskState.taskId, "批准完成");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
    expect(taskState.phaseStatus).toBe("done");
    expect(taskState.resumeFrom).toBeUndefined();
  });

  it("settles phaseStatus when cancelling a running task", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const workflowPhases: WorkflowPhaseConfig[] = [
      {
        name: "build",
        hostRole: "builder",
        needApproval: false,
      },
    ];
    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_cancel_case",
      "cancel_case",
      workflowPhases,
    );
    taskState.currentPhase = "build";
    taskState.phaseStatus = "running";
    taskState.status = TaskStatus.RUNNING;
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "取消用例",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_cancel_case",
      projectConfig,
    });

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        builder: createRole("builder", async () => ({
          summary: "builder done",
          artifacts: [],
        })),
      }),
    });

    await controller.handleIntakeEvent({
      type: "cancel_task",
      taskId: taskState.taskId,
      message: "取消",
      timestamp: Date.now(),
    });

    expect(taskState.status).toBe(TaskStatus.FAILED);
    expect(taskState.phaseStatus).toBe("pending");
  });

  it("preserves resume point when interrupted during approval wait", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");
    await mkdir(projectDir, { recursive: true });

    const runtimeResult = await buildRuntimeForNewTask({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: createDefaultWorkflowPhases(),
      description: "修复登录报错",
    });

    await runtimeResult.runtime.workflow.handleIntakeEvent({
      type: "start_task",
      taskId: runtimeResult.runtime.taskState.taskId,
      message: "修复登录报错",
      timestamp: Date.now(),
    });
    await runtimeResult.runtime.workflow.handleIntakeEvent({
      type: "interrupt_task",
      taskId: runtimeResult.runtime.taskState.taskId,
      message: "手动中断",
      timestamp: Date.now(),
    });

    expect(runtimeResult.runtime.taskState.status).toBe(TaskStatus.INTERRUPTED);
    expect(runtimeResult.runtime.taskState.resumeFrom).toEqual({
      phase: "build",
      roleName: "builder",
      currentStep: "手动中断",
    });
  });
});

class MemoryEventLogger implements EventLogger {
  public readonly events: WorkflowEvent[] = [];

  public async append(event: WorkflowEvent): Promise<void> {
    this.events.push(event);
  }
}

class TestRoleRegistry implements RoleRegistry {
  private readonly roles: Map<RoleName, Role>;

  public constructor(partialRoles: Partial<Record<RoleName, Role>>) {
    this.roles = new Map(
      Object.entries(partialRoles).map(([name, role]) => [name as RoleName, role as Role]),
    );
  }

  public get(name: RoleName): Role {
    const role = this.roles.get(name);

    if (!role) {
      throw new Error(`Role not registered in test registry: ${name}`);
    }

    return role;
  }

  public register(roleDef: RoleDefinition): void {
    this.roles.set(
      roleDef.name,
      roleDef.create({
        projectConfig: {} as never,
        eventEmitter: new EventEmitter(),
        eventLogger: new MemoryEventLogger(),
        roleRegistry: this,
        roleCapabilityProfiles: {} as never,
      }),
    );
  }

  public list(): string[] {
    return [...this.roles.keys()];
  }
}

function createRole(
  name: RoleName,
  run: (input: string, context: ExecutionContext) => Promise<RoleResult>,
): Role {
  return {
    name,
    description: name,
    placeholder: false,
    capabilityProfile: createCapabilityProfile(name),
    run,
  };
}

function createCapabilityProfile(name: RoleName): RoleCapabilityProfile {
  return {
    mode:
      name === "builder" || name === "test-writer"
        ? "delivery"
        : name === "tester" || name === "test-designer"
          ? "verification"
          : "analysis",
    sideEffects:
      name === "builder" ||
      name === "tester" ||
      name === "test-designer" ||
      name === "test-writer"
        ? "allowed"
        : "forbidden",
    allowedActions: [name],
    focus: name,
  };
}

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-runtime-"));
  tempDirs.push(root);
  return root;
}

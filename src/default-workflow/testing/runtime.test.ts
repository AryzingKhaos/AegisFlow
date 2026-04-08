import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
  it("allocates task ids with max-existing-sequence plus one", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");
    await mkdir(path.join(artifactDir, "tasks", "task_20260323_001-old_task"), {
      recursive: true,
    });
    await mkdir(path.join(artifactDir, "tasks", "task_20260325_002-another_task"), {
      recursive: true,
    });
    await mkdir(projectDir, { recursive: true });

    const runtimeResult = await buildRuntimeForNewTask({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: createDefaultWorkflowPhases(),
      description: "修复登录报错",
    });

    expect(runtimeResult.runtime.taskState.taskId).toMatch(
      /^task_\d{8}_003-/,
    );
    expect(
      (await readdir(path.join(artifactDir, "tasks"))).includes(
        runtimeResult.runtime.taskState.taskId,
      ),
    ).toBe(true);
  });

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
      "runtime",
      "task-state.md",
    );
    const eventLogPath = path.join(
      artifactDir,
      "tasks",
      runtimeResult.runtime.taskState.taskId,
      "runtime",
      "workflow-events.jsonl",
    );
    const snapshot = await readFile(snapshotPath, "utf8");
    const eventLog = await readFile(eventLogPath, "utf8");
    const artifactRootEntries = await readdir(artifactDir);
    expect(snapshot).toContain("status: waiting_approval");
    expect(snapshot).toContain("\"phase\": \"build\"");
    expect(eventLog).toContain("\"type\":\"task_start\"");
    expect(artifactRootEntries).not.toContain("workflow-events.jsonl");
  });

  it("writes per-task debug events and transcript for successful tasks", async () => {
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
      "task_debug_success_case",
      "debug_success_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "成功调试转录件用例",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_debug_success_case",
      projectConfig,
    });

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        builder: createRole("builder", async (_input, context) => {
          await context.emitVisibleOutput?.({
            message: "builder 正在输出中间进度",
            kind: "progress",
          });

          return {
            summary: "builder done",
            artifacts: [],
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "成功调试转录件用例");

    const debugEvents = await readFile(
      path.join(
        artifactDir,
        "tasks",
        taskState.taskId,
        "runtime",
        "debug-events.jsonl",
      ),
      "utf8",
    );
    const transcript = await readFile(
      path.join(
        artifactDir,
        "tasks",
        taskState.taskId,
        "runtime",
        "debug-transcript.md",
      ),
      "utf8",
    );

    expect(debugEvents).toContain('"type":"workflow_event"');
    expect(debugEvents).toContain('"type":"role_visible_output"');
    expect(debugEvents).toContain("builder 正在输出中间进度");
    expect(transcript).toContain("# Task Debug Transcript");
    expect(transcript).toContain("暂无 I/O 记录。");
    expect(transcript).not.toContain("## 任务概览");
    expect(transcript).not.toContain("completionSummary:");
    expect(transcript).not.toContain("runtimeFiles:");
    expect(transcript).not.toContain("builder 正在输出中间进度");
  });

  it("highlights executor raw failures in task debug transcript", async () => {
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
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_debug_failure_case",
      "debug_failure_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "失败调试转录件用例",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_debug_failure_case",
      projectConfig,
    });

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        builder: createRole("builder", async (_input, context) => {
          await context.emitDebugEvent?.({
            type: "executor_stderr",
            source: "executor",
            level: "error",
            message: "Traceback: build failed hard",
          });
          await context.emitDebugEvent?.({
            type: "executor_exit",
            source: "executor",
            level: "error",
            message: "executor exited with code 1",
            metadata: {
              code: 1,
              timedOut: false,
            },
          });
          throw new Error("builder crashed");
        }),
      }),
    });

    await controller.run(taskState.taskId, "失败调试转录件用例");

    const debugEvents = await readFile(
      path.join(
        artifactDir,
        "tasks",
        taskState.taskId,
        "runtime",
        "debug-events.jsonl",
      ),
      "utf8",
    );
    const transcript = await readFile(
      path.join(
        artifactDir,
        "tasks",
        taskState.taskId,
        "runtime",
        "debug-transcript.md",
      ),
      "utf8",
    );

    expect(debugEvents).toContain('"type":"executor_stderr"');
    expect(debugEvents).toContain("Traceback: build failed hard");
    expect(debugEvents).toContain('"type":"error"');
    expect(transcript).toContain("# Task Debug Transcript");
    expect(transcript).toContain("暂无 I/O 记录。");
    expect(transcript).not.toContain("## 关键错误");
    expect(transcript).not.toContain("Traceback: build failed hard");
    expect(transcript).not.toContain("builder crashed");
    expect(transcript).not.toContain("latestExecutorSignal:");
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

  it("does not fall back to legacy task state when the new runtime snapshot is corrupted", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");
    await mkdir(projectDir, { recursive: true });

    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: createDefaultWorkflowPhases(),
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_corrupted_runtime_state",
      "corrupted_runtime_state",
      projectConfig.workflowPhases,
    );

    await artifactManager.initializeTask(taskState.taskId);
    await writeFile(
      path.join(artifactDir, "tasks", taskState.taskId, "task-state.json"),
      JSON.stringify({
        ...taskState,
        status: "interrupted",
      }),
      "utf8",
    );
    await writeFile(
      path.join(
        artifactDir,
        "tasks",
        taskState.taskId,
        "runtime",
        "task-state.json",
      ),
      "{broken-json",
      "utf8",
    );

    await expect(artifactManager.loadTaskState(taskState.taskId)).rejects.toThrow();
  });

  it("loads roles.executor config from aegisproject yaml when building runtime", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");
    await mkdir(path.join(projectDir, ".aegisflow"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".aegisflow", "aegisproject.yaml"),
      [
        "roles:",
        '  prototypeDir: "/tmp/roles"',
        "  executor:",
        "    transport:",
        '      type: "child_process"',
        '      cwd: "workspace/runtime"',
        "      timeoutMs: 123456",
        "      env:",
        "        passthrough: false",
        "    provider:",
        '      type: "codex"',
        '      command: "custom-codex"',
        "",
      ].join("\n"),
      "utf8",
    );

    const runtimeResult = await buildRuntimeForNewTask({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: createDefaultWorkflowPhases(),
      description: "读取角色执行器配置",
    });

    expect(runtimeResult.runtime.projectConfig.roleExecutor).toEqual({
      transport: {
        type: "child_process",
        cwd: path.join(projectDir, "workspace/runtime"),
        timeoutMs: 123456,
        env: {
          passthrough: false,
        },
      },
      provider: {
        type: "codex",
        command: "custom-codex",
      },
    });
  });

  it("reloads roles.executor config from aegisproject yaml when resuming runtime", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");
    await mkdir(path.join(projectDir, ".aegisflow"), { recursive: true });

    const configPath = path.join(projectDir, ".aegisflow", "aegisproject.yaml");
    await writeFile(
      configPath,
      [
        "roles:",
        "  executor:",
        "    transport:",
        '      type: "child_process"',
        '      cwd: "."',
        "      timeoutMs: 1000",
        "      env:",
        "        passthrough: true",
        "    provider:",
        '      type: "codex"',
        '      command: "codex-first"',
        "",
      ].join("\n"),
      "utf8",
    );

    const newRuntimeResult = await buildRuntimeForNewTask({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: createDefaultWorkflowPhases(),
      description: "恢复时重新读取角色执行器配置",
    });

    await writeFile(
      configPath,
      [
        "roles:",
        "  executor:",
        "    transport:",
        '      type: "child_process"',
        '      cwd: "runtime/override"',
        "      timeoutMs: 2000",
        "      env:",
        "        passthrough: false",
        "    provider:",
        '      type: "codex"',
        '      command: "codex-second"',
        "",
      ].join("\n"),
      "utf8",
    );

    const resumedRuntimeResult = await buildRuntimeForResume({
      projectConfig: newRuntimeResult.persistedContext.projectConfig,
      persistedContext: newRuntimeResult.persistedContext,
    });

    expect(resumedRuntimeResult.runtime.projectConfig.roleExecutor).toEqual({
      transport: {
        type: "child_process",
        cwd: path.join(projectDir, "runtime/override"),
        timeoutMs: 2000,
        env: {
          passthrough: false,
        },
      },
      provider: {
        type: "codex",
        command: "codex-second",
      },
    });
  });

  it("falls back to current defaults when roles.executor is removed before resume", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");
    await mkdir(path.join(projectDir, ".aegisflow"), { recursive: true });

    const configPath = path.join(projectDir, ".aegisflow", "aegisproject.yaml");
    await writeFile(
      configPath,
      [
        "roles:",
        "  executor:",
        "    transport:",
        '      type: "child_process"',
        '      cwd: "runtime/custom"',
        "      timeoutMs: 2000",
        "      env:",
        "        passthrough: false",
        "    provider:",
        '      type: "codex"',
        '      command: "codex-custom"',
        "",
      ].join("\n"),
      "utf8",
    );

    const newRuntimeResult = await buildRuntimeForNewTask({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: createDefaultWorkflowPhases(),
      description: "恢复时删除角色执行器配置",
    });

    await writeFile(
      configPath,
      [
        "roles:",
        '  prototypeDir: "/tmp/roles"',
        "",
      ].join("\n"),
      "utf8",
    );

    const resumedRuntimeResult = await buildRuntimeForResume({
      projectConfig: newRuntimeResult.persistedContext.projectConfig,
      persistedContext: newRuntimeResult.persistedContext,
    });

    expect(resumedRuntimeResult.runtime.projectConfig.roleExecutor).toEqual({
      transport: {
        type: "child_process",
        cwd: projectDir,
        timeoutMs: 300000,
        env: {
          passthrough: true,
        },
      },
      provider: {
        type: "codex",
        command: "codex",
      },
    });
    expect(resumedRuntimeResult.persistedContext.projectConfig.roleExecutor).toEqual({
      transport: {
        type: "child_process",
        cwd: projectDir,
        timeoutMs: 300000,
        env: {
          passthrough: true,
        },
      },
      provider: {
        type: "codex",
        command: "codex",
      },
    });
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
            message: "\n第一段分析\n第二段分析\n",
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
    ).toEqual(["\n第一段分析\n第二段分析\n", "最终结论：进入实现阶段"]);
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
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "补齐 API 细节");

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
            if (input.includes("正式生成 PRD")) {
              return {
                summary: "clarifier:final-prd",
                artifacts: ["# final prd\n\ncontent"],
                metadata: {
                  decision: "final_prd_generated",
                },
              };
            }

            return {
              summary: `clarifier:${input}`,
              artifacts: [],
              metadata: {
                decision: "ready_for_prd",
              },
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
      "runtime",
      "task-state.md",
    );
    const snapshot = await readFile(snapshotPath, "utf8");
    expect(snapshot).toContain("status: completed");
  });

  it("exposes only clarify final-prd to explore phase", async () => {
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
      {
        name: "explore",
        hostRole: "explorer",
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
      "task_explore_visibility_case",
      "explore_visibility_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "补齐 API 细节",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_explore_visibility_case",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "补齐 API 细节");

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async (input) => {
          if (input.includes("正式生成 PRD")) {
            return {
              summary: "clarifier:final-prd",
              artifacts: ["# final prd\n\ncontent"],
            };
          }

          return {
            summary: "clarifier:ready-for-prd",
            artifacts: [],
            metadata: {
              decision: "ready_for_prd",
            },
          };
        }),
        explorer: createRole("explorer", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual(["clarify/final-prd"]);
          const visiblePrd = await context.artifacts.get("clarify/final-prd");

          expect(visiblePrd).toContain("# final prd");
          expect(visiblePrd).toContain("## 文档摘要");
          expect(visiblePrd).toContain("clarifier:final-prd");
          expect(await context.artifacts.get("clarify/initial-requirement")).toBeUndefined();
          expect(await context.artifacts.get("clarify/clarify-dialogue")).toBeUndefined();

          return {
            summary: "explorer done",
            artifacts: ["# explore artifact\n\ncontent"],
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "补齐 API 细节");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
  });

  it("reinjects initial-requirement and clarify-dialogue into every clarify execution", async () => {
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
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_clarify_reinjection_case",
      "clarify_reinjection_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "补齐 API 细节",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_clarify_reinjection_case",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "补齐 API 细节");

    const observedCalls: Array<{
      input: string;
      visibleKeys: string[];
      initialRequirement?: string;
      clarifyDialogue?: string;
    }> = [];

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async (input, context) => {
          observedCalls.push({
            input,
            visibleKeys: await context.artifacts.list(),
            initialRequirement: await context.artifacts.get("clarify/initial-requirement"),
            clarifyDialogue: await context.artifacts.get("clarify/clarify-dialogue"),
          });

          if (input.includes("正式生成 PRD")) {
            return {
              summary: "clarifier final prd",
              artifacts: ["# Clarify PRD\n\nsource from reinjected dialogue"],
            };
          }

          if (observedCalls.length === 1) {
            return {
              summary: "clarifier ask question",
              artifacts: [],
              phaseCompleted: false,
              metadata: {
                decision: "ask_next_question",
                question: "请补充接口兼容范围",
              },
            };
          }

          return {
            summary: "clarifier ready-for-prd",
            artifacts: [],
            metadata: {
              decision: "ready_for_prd",
            },
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "补齐 API 细节");
    expect(taskState.status).toBe(TaskStatus.WAITING_USER_INPUT);

    await controller.handleIntakeEvent({
      type: "participate",
      taskId: taskState.taskId,
      message: "接口返回 code 还要兼容旧版",
      timestamp: Date.now(),
    });

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
    expect(observedCalls).toHaveLength(3);
    expect(observedCalls.map((call) => call.visibleKeys)).toEqual([
      ["clarify/initial-requirement", "clarify/clarify-dialogue"],
      ["clarify/initial-requirement", "clarify/clarify-dialogue"],
      ["clarify/initial-requirement", "clarify/clarify-dialogue"],
    ]);
    expect(observedCalls[0]?.initialRequirement).toContain("补齐 API 细节");
    expect(observedCalls[0]?.clarifyDialogue).toContain("# Clarify Dialogue");
    expect(observedCalls[1]?.clarifyDialogue).toContain("## Round 1 Question");
    expect(observedCalls[1]?.clarifyDialogue).toContain("请补充接口兼容范围");
    expect(observedCalls[1]?.clarifyDialogue).toContain("## Round 1 Answer");
    expect(observedCalls[1]?.clarifyDialogue).toContain("接口返回 code 还要兼容旧版");
    expect(observedCalls[2]?.initialRequirement).toContain("补齐 API 细节");
    expect(observedCalls[2]?.clarifyDialogue).toContain("接口返回 code 还要兼容旧版");
  });

  it("fails clarify immediately when initial-requirement is missing", async () => {
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
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_clarify_missing_initial_requirement_case",
      "clarify_missing_initial_requirement_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "补齐 API 细节",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_clarify_missing_initial_requirement_case",
      projectConfig,
    });

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async () => ({
          summary: "clarifier should not run",
          artifacts: [],
          metadata: {
            decision: "ready_for_prd",
          },
        })),
      }),
    });

    const events = await controller.run(taskState.taskId, "补齐 API 细节");

    expect(taskState.status).toBe(TaskStatus.FAILED);
    expect(events.at(-2)?.type).toBe("error");
    expect(events.at(-2)?.metadata?.error).toContain(
      "missing clarify/initial-requirement artifact",
    );
  });

  it("passes initialRequirementInputKind into clarify role context", async () => {
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
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_clarify_input_kind_case",
      "clarify_input_kind_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "prd path case",
      requirementTitle: "prd path case",
      initialRequirementInput: "input-prd.md",
      initialRequirementInputKind: "prd_path",
      awaitingInitialRequirement: false,
      createdAt: Date.now(),
      lastRuntimeId: "runtime_clarify_input_kind_case",
      latestInput: "input-prd.md",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "input-prd.md", "prd_path");

    let observedKind: string | undefined;
    let observedInitialRequirement: string | undefined;
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async (_input, context) => {
          observedKind = context.initialRequirementInputKind;
          observedInitialRequirement = await context.artifacts.get("clarify/initial-requirement");

          return {
            summary: "clarifier ready-for-prd",
            artifacts: [],
            metadata: {
              decision: "ready_for_prd",
            },
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "input-prd.md");

    expect(observedKind).toBe("prd_path");
    expect(observedInitialRequirement).toBe("input-prd.md");
  });

  it("normalizes clarify final-prd before saving and exposing it to the next phase", async () => {
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
      {
        name: "explore",
        hostRole: "explorer",
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
      "task_clarify_final_markdown_case",
      "clarify_final_markdown_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "生成 PRD",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_clarify_final_markdown_case",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "生成 PRD");

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async (input) => {
          if (input.includes("正式生成 PRD")) {
            return {
              summary: "PRD 已生成",
              artifacts: [
                JSON.stringify({
                  summary: "这是最终 PRD 摘要",
                  artifacts: [
                    "# Final PRD\n\n## Goal\n\n让最终工件直接可读。",
                  ],
                  metadata: {
                    notes: ["保留关键补充说明"],
                  },
                }),
              ],
              metadata: {
                decision: "final_prd_generated",
              },
            };
          }

          return {
            summary: "clarifier ready-for-prd",
            artifacts: [],
            metadata: {
              decision: "ready_for_prd",
            },
          };
        }),
        explorer: createRole("explorer", async (_input, context) => {
          const visiblePrd = await context.artifacts.get("clarify/final-prd");

          expect(visiblePrd).toContain("# Final PRD");
          expect(visiblePrd).toContain("## Goal");
          expect(visiblePrd).toContain("## 文档摘要");
          expect(visiblePrd).toContain("PRD 已生成");
          expect(visiblePrd).toContain("## 补充说明");
          expect(visiblePrd).toContain("保留关键补充说明");
          expect(visiblePrd).not.toContain('"artifacts"');

          return {
            summary: "explorer done",
            artifacts: ["# explore artifact\n\ncontent"],
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "生成 PRD");

    const savedPrd = await readFile(
      path.join(
        artifactDir,
        "tasks",
        taskState.taskId,
        "artifacts",
        "clarify",
        "final-prd.md",
      ),
      "utf8",
    );

    expect(savedPrd).toContain("# Final PRD");
    expect(savedPrd).toContain("## 文档摘要");
    expect(savedPrd).not.toContain('"summary"');
    expect(savedPrd).not.toContain('"artifacts"');
  });

  it("normalizes the generic phase final artifact and keeps it visible to the next phase", async () => {
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
      "task_plan_final_markdown_case",
      "plan_final_markdown_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "输出计划工件",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_plan_final_markdown_case",
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
          summary: "当前不建议继续推进。",
          artifacts: [
            JSON.stringify({
              planTitle: "Implementation Plan",
              steps: ["确认接口", "补测试", "落代码"],
            }),
            "# secondary artifact\n\nraw",
          ],
          metadata: {
            blockingQuestions: ["缺少接口返回字段定义"],
            notes: ["等待后端确认 schema"],
            recommendation: "当前不建议继续推进。",
          },
        })),
        builder: createRole("builder", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual(["plan/plan-planner-1"]);

          const planArtifact = await context.artifacts.get("plan/plan-planner-1");

          expect(planArtifact).toContain("## Plan Title");
          expect(planArtifact).toContain("Implementation Plan");
          expect(planArtifact).toContain("## Blocking Questions");
          expect(planArtifact).toContain("缺少接口返回字段定义");
          expect(planArtifact).toContain("## 结论");
          expect(planArtifact).toContain("当前不建议继续推进。");
          expect(planArtifact).not.toContain('"planTitle"');
          expect(await context.artifacts.get("plan/plan-planner-2")).toBeUndefined();

          return {
            summary: "builder done",
            artifacts: ["# build artifact\n\ncontent"],
          };
        }),
      }),
    });

    const events = await controller.run(taskState.taskId, "输出计划工件");
    const savedPlan = await readFile(
      path.join(
        artifactDir,
        "tasks",
        taskState.taskId,
        "artifacts",
        "plan",
        "plan-planner-1.md",
      ),
      "utf8",
    );

    expect(savedPlan).toContain("## Plan Title");
    expect(savedPlan).toContain("## Blocking Questions");
    expect(savedPlan).toContain("## 补充说明");
    expect(savedPlan).toContain("## 结论");
    expect(savedPlan).not.toContain('"steps"');
    expect(
      events.some(
        (event) =>
          event.type === "artifact_created" &&
          event.metadata?.artifactKey === "plan-planner-1" &&
          event.metadata?.finalArtifact === true,
      ),
    ).toBe(true);
  });

  it("uses explicit artifactInputPhases to expose multiple source phases to build", async () => {
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
      {
        name: "plan",
        hostRole: "planner",
        needApproval: false,
        artifactInputPhases: ["clarify"],
      },
      {
        name: "build",
        hostRole: "builder",
        needApproval: false,
        artifactInputPhases: ["clarify", "plan"],
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
      "task_multi_phase_artifact_input",
      "multi_phase_artifact_input",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "多来源工件输入",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_multi_phase_artifact_input",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "多来源工件输入");

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async (input) => {
          if (input.includes("正式生成 PRD")) {
            return {
              summary: "clarify final prd",
              artifacts: ["# Clarify PRD\n\nsource from clarify"],
              metadata: {
                decision: "final_prd_generated",
              },
            };
          }

          return {
            summary: "clarifier ready-for-prd",
            artifacts: [],
            metadata: {
              decision: "ready_for_prd",
            },
          };
        }),
        planner: createRole("planner", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual(["clarify/final-prd"]);

          return {
            summary: "planner summary",
            artifacts: ["# Plan\n\nsource from plan"],
          };
        }),
        builder: createRole("builder", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual([
            "clarify/final-prd",
            "plan/plan-planner-1",
          ]);
          expect(await context.artifacts.get("clarify/final-prd")).toContain(
            "source from clarify",
          );
          expect(await context.artifacts.get("plan/plan-planner-1")).toContain(
            "source from plan",
          );

          return {
            summary: "builder summary",
            artifacts: ["# Build\n\nimplemented"],
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "多来源工件输入");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
  });

  it("uses explicit artifactInputPhases to read only plan artifacts for build", async () => {
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
      {
        name: "plan",
        hostRole: "planner",
        needApproval: false,
      },
      {
        name: "build",
        hostRole: "builder",
        needApproval: false,
        artifactInputPhases: ["plan"],
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
      "task_single_phase_artifact_input",
      "single_phase_artifact_input",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "单来源工件输入",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_single_phase_artifact_input",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "单来源工件输入");

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async (input) => {
          if (input.includes("正式生成 PRD")) {
            return {
              summary: "clarify final prd",
              artifacts: ["# Clarify PRD\n\nsource from clarify"],
              metadata: {
                decision: "final_prd_generated",
              },
            };
          }

          return {
            summary: "clarifier ready-for-prd",
            artifacts: [],
            metadata: {
              decision: "ready_for_prd",
            },
          };
        }),
        planner: createRole("planner", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual(["clarify/final-prd"]);

          return {
            summary: "planner summary",
            artifacts: ["# Plan\n\nsource from plan"],
          };
        }),
        builder: createRole("builder", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual(["plan/plan-planner-1"]);
          expect(await context.artifacts.get("plan/plan-planner-1")).toContain(
            "source from plan",
          );
          expect(await context.artifacts.get("clarify/final-prd")).toBeUndefined();

          return {
            summary: "builder summary",
            artifacts: ["# Build\n\nimplemented"],
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "单来源工件输入");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
  });

  it("falls back to previous phase artifacts when artifactInputPhases is undefined", async () => {
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
      {
        name: "plan",
        hostRole: "planner",
        needApproval: false,
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
      "task_default_artifact_input_fallback",
      "default_artifact_input_fallback",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "默认来源回退",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_default_artifact_input_fallback",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "默认来源回退");

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async (input) => {
          if (input.includes("正式生成 PRD")) {
            return {
              summary: "clarify final prd",
              artifacts: ["# Clarify PRD\n\nsource from clarify"],
              metadata: {
                decision: "final_prd_generated",
              },
            };
          }

          return {
            summary: "clarifier ready-for-prd",
            artifacts: [],
            metadata: {
              decision: "ready_for_prd",
            },
          };
        }),
        planner: createRole("planner", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual(["clarify/final-prd"]);

          return {
            summary: "planner summary",
            artifacts: ["# Plan\n\nsource from plan"],
          };
        }),
        builder: createRole("builder", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual(["plan/plan-planner-1"]);
          expect(await context.artifacts.get("plan/plan-planner-1")).toContain(
            "source from plan",
          );
          expect(await context.artifacts.get("clarify/final-prd")).toBeUndefined();

          return {
            summary: "builder summary",
            artifacts: ["# Build\n\nimplemented"],
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "默认来源回退");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
  });

  it("preserves the configured artifactInputPhases order", async () => {
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
      {
        name: "plan",
        hostRole: "planner",
        needApproval: false,
        artifactInputPhases: ["clarify"],
      },
      {
        name: "build",
        hostRole: "builder",
        needApproval: false,
        artifactInputPhases: ["plan", "clarify"],
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
      "task_artifact_input_order",
      "artifact_input_order",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "来源顺序",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_artifact_input_order",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "来源顺序");

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async (input) => {
          if (input.includes("正式生成 PRD")) {
            return {
              summary: "clarify final prd",
              artifacts: ["# Clarify PRD\n\nsource from clarify"],
              metadata: {
                decision: "final_prd_generated",
              },
            };
          }

          return {
            summary: "clarifier ready-for-prd",
            artifacts: [],
            metadata: {
              decision: "ready_for_prd",
            },
          };
        }),
        planner: createRole("planner", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual(["clarify/final-prd"]);

          return {
            summary: "planner summary",
            artifacts: ["# Plan\n\nsource from plan"],
          };
        }),
        builder: createRole("builder", async (_input, context) => {
          expect(await context.artifacts.list()).toEqual([
            "plan/plan-planner-1",
            "clarify/final-prd",
          ]);

          return {
            summary: "builder summary",
            artifacts: ["# Build\n\nimplemented"],
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "来源顺序");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
  });

  it("fails clarify when metadata.decision is missing or invalid", async () => {
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
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_clarify_invalid_decision",
      "clarify_invalid_decision",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "补齐 API 细节",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_clarify_invalid_decision",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "补齐 API 细节");

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async () => ({
          summary: "clarifier returned invalid decision",
          artifacts: [],
          metadata: {
            decision: "done",
          },
        })),
      }),
    });

    const events = await controller.run(taskState.taskId, "补齐 API 细节");

    expect(taskState.status).toBe(TaskStatus.FAILED);
    expect(events.at(-2)?.type).toBe("error");
    expect(events.at(-2)?.metadata?.error).toContain(
      "metadata.decision as ask_next_question or ready_for_prd",
    );
  });

  it("fails clarify when final PRD generation does not return a writable artifact", async () => {
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
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_clarify_invalid_final_prd",
      "clarify_invalid_final_prd",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "补齐 API 细节",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_clarify_invalid_final_prd",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "补齐 API 细节");

    let callCount = 0;
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async () => {
          callCount += 1;

          if (callCount === 1) {
            return {
              summary: "clarifier ready for prd",
              artifacts: [],
              metadata: {
                decision: "ready_for_prd",
              },
            };
          }

          return {
            summary: "final prd generation returned summary only",
            artifacts: [],
            artifactReady: false,
            phaseCompleted: true,
            metadata: {
              decision: "final_prd_generated",
            },
          };
        }),
      }),
    });

    const events = await controller.run(taskState.taskId, "补齐 API 细节");

    expect(taskState.status).toBe(TaskStatus.FAILED);
    expect(
      events.some(
        (event) =>
          event.type === "artifact_created" &&
          event.metadata?.artifactKey === "final-prd",
      ),
    ).toBe(false);
    expect(events.at(-2)?.metadata?.error).toContain("artifactReady=false");
  });

  it("fails clarify when clarify-dialogue is missing before a follow-up clarify turn", async () => {
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
      workflow: createWorkflowSelection("feature_change"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_clarify_missing_dialogue_case",
      "clarify_missing_dialogue_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "补齐 API 细节",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_clarify_missing_dialogue_case",
      projectConfig,
    });
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "补齐 API 细节");

    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new TestRoleRegistry({
        clarifier: createRole("clarifier", async () => ({
          summary: "clarifier ask question",
          artifacts: [],
          phaseCompleted: false,
          metadata: {
            decision: "ask_next_question",
            question: "请补充接口兼容范围",
          },
        })),
      }),
    });

    await controller.run(taskState.taskId, "补齐 API 细节");
    expect(taskState.status).toBe(TaskStatus.WAITING_USER_INPUT);

    await rm(
      path.join(
        artifactDir,
        "tasks",
        taskState.taskId,
        "artifacts",
        "clarify",
        "clarify-dialogue.md",
      ),
    );

    const events = await controller.handleIntakeEvent({
      type: "participate",
      taskId: taskState.taskId,
      message: "接口返回 code 还要兼容旧版",
      timestamp: Date.now(),
    });

    expect(taskState.status).toBe(TaskStatus.FAILED);
    expect(events.at(-2)?.type).toBe("error");
    expect(events.at(-2)?.metadata?.error).toContain(
      "missing clarify/clarify-dialogue artifact",
    );
  });

  it("defers participate input while task is running under one-shot execution", async () => {
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
      "task_active_role_input_case",
      "active_role_input_case",
      workflowPhases,
    );
    taskState.currentPhase = "build";
    taskState.phaseStatus = "running";
    taskState.status = TaskStatus.RUNNING;
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "运行中输入透传",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_active_role_input_case",
      projectConfig,
    });

    const roleRegistry = new TrackableRoleRegistry({
      builder: createRole("builder", async () => ({
        summary: "builder done",
        artifacts: [],
      })),
    });
    roleRegistry.activate("builder");
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry,
    });

    const events = await controller.handleIntakeEvent({
      type: "participate",
      taskId: taskState.taskId,
      message: "这是发给 active role 的输入",
      timestamp: Date.now(),
    });

    expect(roleRegistry.forwardedInputs).toEqual([]);
    expect(events.at(0)?.type).toBe("progress");
    expect(events.at(0)?.message).toBe(
      "当前默认执行模型为 one-shot；运行中输入不会透传到 active role，请在当前阶段结束后通过恢复链路继续。",
    );
  });

  it("reports deferred participation even when a test registry exposes input delivery hooks", async () => {
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
      "task_active_role_input_rejected",
      "active_role_input_rejected",
      workflowPhases,
    );
    taskState.currentPhase = "build";
    taskState.phaseStatus = "running";
    taskState.status = TaskStatus.RUNNING;
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "运行中输入拒收",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_active_role_input_rejected",
      projectConfig,
    });

    const roleRegistry = new TrackableRoleRegistry({
      builder: createRole("builder", async () => ({
        summary: "builder done",
        artifacts: [],
      })),
    });
    roleRegistry.activate("builder");
    roleRegistry.deliveryResult = {
      accepted: false,
      mode: "rejected",
      reason: "executor_unavailable",
    };
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry,
    });

    const events = await controller.handleIntakeEvent({
      type: "participate",
      taskId: taskState.taskId,
      message: "这是可能被丢弃的输入",
      timestamp: Date.now(),
    });

    expect(events.at(0)?.type).toBe("progress");
    expect(events.at(0)?.message).toBe(
      "当前默认执行模型为 one-shot；运行中输入不会透传到 active role，请在当前阶段结束后通过恢复链路继续。",
    );
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
    await seedInitialRequirementArtifact(artifactManager, taskState.taskId, "失败用例");

    const logger = new MemoryEventLogger();
    const roleRegistry = new TrackableRoleRegistry({
      clarifier: {
        name: "clarifier",
        description: "clarifier",
        placeholder: false,
        capabilityProfile: createCapabilityProfile("clarifier"),
        async run(): Promise<RoleResult> {
          throw new Error("clarify exploded");
        },
      },
    });
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: logger,
      artifactManager,
      roleRegistry,
    });

    const events = await controller.run(taskState.taskId, "失败用例");

    expect(taskState.status).toBe(TaskStatus.FAILED);
    expect(taskState.phaseStatus).toBe("pending");
    expect(events.at(-2)?.type).toBe("error");
    expect(events.at(-1)?.type).toBe("task_end");
    expect(roleRegistry.disposeAllCalls).toBe(0);
    expect(logger.events.some((event) => event.type === "error")).toBe(true);

    const snapshotPath = path.join(
      artifactDir,
      "tasks",
      taskState.taskId,
      "runtime",
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

    const roleRegistry = new TrackableRoleRegistry({
      planner: createRole("planner", async () => ({
        summary: "planner done",
        artifacts: [],
      })),
    });
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry,
    });

    await controller.run(taskState.taskId, "最终审批用例");

    expect(taskState.status).toBe(TaskStatus.WAITING_APPROVAL);
    expect(taskState.phaseStatus).toBe("done");
    expect(taskState.resumeFrom).toEqual({
      phase: "plan",
      roleName: "planner",
      currentStep: "waiting_final_approval_after_plan",
    });
    expect(roleRegistry.disposeAllCalls).toBe(0);

    await controller.resume(taskState.taskId, "批准完成");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
    expect(taskState.phaseStatus).toBe("done");
    expect(taskState.resumeFrom).toBeUndefined();
    expect(roleRegistry.disposeAllCalls).toBe(0);
  });

  it("keeps role sessions after task completes normally", async () => {
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
      "task_dispose_on_complete",
      "dispose_on_complete",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "完成后清理会话",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_dispose_on_complete",
      projectConfig,
    });

    const roleRegistry = new TrackableRoleRegistry({
      builder: createRole("builder", async () => ({
        summary: "builder done",
        artifacts: [],
      })),
    });
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry,
    });

    await controller.run(taskState.taskId, "完成后清理会话");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
    expect(roleRegistry.disposeAllCalls).toBe(0);
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

    const roleRegistry = new TrackableRoleRegistry({
      builder: createRole("builder", async () => ({
        summary: "builder done",
        artifacts: [],
      })),
    });
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry,
    });

    await controller.handleIntakeEvent({
      type: "cancel_task",
      taskId: taskState.taskId,
      message: "取消",
      timestamp: Date.now(),
    });

    expect(taskState.status).toBe(TaskStatus.FAILED);
    expect(taskState.phaseStatus).toBe("pending");
    expect(roleRegistry.disposeAllCalls).toBe(0);
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
  private activeRoleName?: RoleName;

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

  public activate(name: RoleName): Role {
    const role = this.get(name);
    this.activeRoleName = name;
    return role;
  }

  public getActive(): Role | undefined {
    if (!this.activeRoleName) {
      return undefined;
    }

    return this.roles.get(this.activeRoleName);
  }

  public getActiveRoleName(): RoleName | undefined {
    return this.activeRoleName;
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

class TrackableRoleRegistry extends TestRoleRegistry {
  public disposeAllCalls = 0;
  public forwardedInputs: string[] = [];
  public deliveryResult = {
    accepted: true,
    mode: "queued" as const,
  };

  public override activate(name: RoleName): Role {
    return super.activate(name);
  }

  public async disposeAll(): Promise<void> {
    this.disposeAllCalls += 1;
  }

  public async sendInputToActiveRole(input: string) {
    this.forwardedInputs.push(input);
    return this.deliveryResult;
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

async function seedInitialRequirementArtifact(
  artifactManager: FileArtifactManager,
  taskId: string,
  content: string,
  kind: "text" | "prd_path" = "text",
): Promise<void> {
  await artifactManager.saveArtifact(taskId, {
    key: "initial-requirement",
    phase: "clarify",
    roleName: "clarifier",
    title: "initial-requirement",
    content,
  });

  const taskContext = await artifactManager.loadTaskContext(taskId);
  taskContext.initialRequirementInput = content;
  taskContext.initialRequirementInputKind = kind;
  taskContext.awaitingInitialRequirement = false;
  taskContext.latestInput = content;
  await artifactManager.saveTaskContext(taskContext);
}

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-runtime-"));
  tempDirs.push(root);
  return root;
}

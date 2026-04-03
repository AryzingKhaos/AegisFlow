import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntakeAgent } from "../intake/agent";
import { formatWorkflowEventForCli } from "../intake/output";
import { TaskStatus, type WorkflowEvent } from "../shared/types";

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

describe("IntakeAgent", () => {
  it("accepts cancel commands during pending collection steps", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("修复登录报错");

    const lines = await agent.handleUserInput("取消任务");

    expect(lines).toEqual(["已取消当前任务创建流程。"]);
  });

  it("restores the interrupted task from the custom artifact directory after CLI restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "custom-artifacts");
    await mkdir(projectDir, { recursive: true });
    await writeProjectWorkflowConfig(projectDir);

    const firstAgent = new IntakeAgent(root);
    await firstAgent.handleUserInput("修复登录报错");
    await firstAgent.handleUserInput(projectDir);
    await firstAgent.handleUserInput("y");
    const startLines = await firstAgent.handleUserInput(artifactDir);
    const interruptResult = await firstAgent.handleInterruptSignal();
    const [taskId] = await readdir(path.join(artifactDir, "tasks"));

    expect(startLines.join("\n")).toContain(`工件目录：${artifactDir}`);
    expect(interruptResult.lines.join("\n")).toContain("status=interrupted");

    const secondAgent = new IntakeAgent(root);
    const resumeLines = await secondAgent.handleUserInput("恢复任务");

    expect(resumeLines.join("\n")).toContain(`恢复任务：${taskId}`);
    expect(resumeLines.join("\n")).toContain("Runtime 已重建");
  });

  it("formats workflow events into readable cli blocks instead of raw object lines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectWorkflowConfig(projectDir);
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("修复登录报错");
    await agent.handleUserInput(projectDir);
    await agent.handleUserInput("y");
    const lines = await agent.handleUserInput("");

    const rendered = lines.join("\n");
    expect(rendered).toContain("=== 任务开始 ===");
    expect(rendered).toContain("=== 阶段开始｜clarify ===");
    expect(rendered).toContain("--- 角色开始｜clarifier @ clarify ---");
    expect(rendered).toContain("clarifier 已通过 stub Agent 完成澄清判断。");
    expect(rendered).toContain("clarifier 已基于初始需求与问答生成最终 PRD。");
    expect(rendered).not.toContain("[WorkflowEvent:");
    expect(rendered).not.toContain("metadata=");
    expect(rendered).not.toContain(">>> 角色输出｜");
    expect(rendered).toContain("TaskState 摘要：");
  });

  it("streams workflow output through the listener instead of waiting for the final return lines", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectWorkflowConfig(projectDir);

    const streamedLines: string[] = [];
    const agent = new IntakeAgent(root, {
      onWorkflowOutput(lines) {
        streamedLines.push(...lines);
      },
    });

    await agent.handleUserInput("修复登录报错");
    await agent.handleUserInput(projectDir);
    await agent.handleUserInput("y");
    const lines = await agent.handleUserInput("");

    expect(lines.join("\n")).toContain("Runtime 初始化成功");
    expect(lines.join("\n")).not.toContain("=== 任务开始 ===");
    expect(streamedLines.join("\n")).toContain("=== 任务开始 ===");
    expect(streamedLines.join("\n")).toContain(
      "clarifier 已通过 stub Agent 完成澄清判断。",
    );
    expect(streamedLines.join("\n")).not.toContain(">>> 角色输出｜");
  });

  it("reuses the current runtime when resuming inside the same intake session", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectWorkflowConfig(projectDir);

    const agent = new IntakeAgent(root);
    await agent.handleUserInput("修复登录报错");
    await agent.handleUserInput(projectDir);
    await agent.handleUserInput("y");
    await agent.handleUserInput("");
    await agent.handleInterruptSignal();

    const runtimeIdBeforeResume = (agent as unknown as { runtime?: { runtimeId: string } })
      .runtime?.runtimeId;
    const lines = await agent.handleUserInput("恢复任务");
    const runtimeIdAfterResume = (agent as unknown as { runtime?: { runtimeId: string } })
      .runtime?.runtimeId;

    expect(runtimeIdBeforeResume).toBeDefined();
    expect(runtimeIdAfterResume).toBe(runtimeIdBeforeResume);
    expect(lines.join("\n")).not.toContain("Runtime 已重建");
  });

  it("disposes all role sessions when intake is disposed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectWorkflowConfig(projectDir);

    const agent = new IntakeAgent(root);
    await agent.handleUserInput("修复登录报错");
    await agent.handleUserInput(projectDir);
    await agent.handleUserInput("y");
    await agent.handleUserInput("");

    const runtime = (agent as unknown as {
      runtime?: {
        roleRegistry?: {
          disposeAll?: () => Promise<void>;
        };
      };
    }).runtime;
    let disposeCalls = 0;

    if (runtime?.roleRegistry) {
      runtime.roleRegistry.disposeAll = async () => {
        disposeCalls += 1;
      };
    }

    await agent.dispose();

    expect(disposeCalls).toBe(1);
    expect((agent as unknown as { runtime?: unknown }).runtime).toBeUndefined();
  });

  it("marks running participate input as live passthrough candidate", () => {
    const agent = new IntakeAgent("/tmp");
    const mutableAgent = agent as unknown as {
      runtime?: {
        taskState: {
          status: TaskStatus;
        };
      };
    };

    mutableAgent.runtime = {
      taskState: {
        status: TaskStatus.RUNNING,
      },
    };

    expect(agent.shouldHandleInputAsLiveParticipation("补充一下这里的边界条件")).toBe(true);
    expect(agent.shouldHandleInputAsLiveParticipation("继续执行")).toBe(false);
    expect(agent.shouldHandleInputAsLiveParticipation("取消任务")).toBe(false);
  });

  it("does not dispatch resume_task when the task is already running", async () => {
    const agent = new IntakeAgent("/tmp");
    let dispatchedEvents = 0;
    const mutableAgent = agent as unknown as {
      runtime?: {
        taskState: {
          status: TaskStatus;
        };
        workflow: {
          handleIntakeEvent: () => Promise<void>;
        };
      };
    };

    mutableAgent.runtime = {
      taskState: {
        status: TaskStatus.RUNNING,
      },
      workflow: {
        async handleIntakeEvent() {
          dispatchedEvents += 1;
        },
      },
    };

    const lines = await agent.handleUserInput("继续执行当前任务");

    expect(lines).toEqual(["当前任务正在执行中，无需恢复。"]);
    expect(dispatchedEvents).toBe(0);
  });

  it("passes through role output without rewriting escape characters", () => {
    const rendered = formatWorkflowEventForCli({
      type: "role_output",
      taskId: "task_demo",
      message: "第一行\\n第二行",
      timestamp: Date.now(),
      taskState: {
        taskId: "task_demo",
        title: "demo",
        currentPhase: "plan",
        phaseStatus: "running",
        status: TaskStatus.RUNNING,
        updatedAt: Date.now(),
      },
      metadata: {
        phase: "plan",
        roleName: "planner",
        outputKind: "summary",
      },
    } satisfies WorkflowEvent).join("\n");

    expect(rendered).toBe("第一行\\n第二行");
  });

  it("preserves role output whitespace and code block boundaries", () => {
    const rendered = formatWorkflowEventForCli({
      type: "role_output",
      taskId: "task_demo",
      message: "\n- 第一步\n\n```ts\nconst answer = 42;\n```\n",
      timestamp: Date.now(),
      taskState: {
        taskId: "task_demo",
        title: "demo",
        currentPhase: "plan",
        phaseStatus: "running",
        status: TaskStatus.RUNNING,
        updatedAt: Date.now(),
      },
      metadata: {
        phase: "plan",
        roleName: "planner",
        outputKind: "summary",
      },
    } satisfies WorkflowEvent);

    expect(rendered).toEqual(["\n- 第一步\n\n```ts\nconst answer = 42;\n```\n"]);
  });

  it("recommends workflow from project config before runtime initialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectWorkflowConfig(projectDir);
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("修复登录报错");
    const lines = await agent.handleUserInput(projectDir);

    expect(lines).toContain(`目标项目目录已确认：${projectDir}`);
    expect(lines).toContain(`推荐 workflow：bugfix-workflow`);
    expect(lines.some((line) => line.includes("推荐理由："))).toBe(true);
    expect(lines).toContain(
      "流程编排：clarify -> explore -> plan -> build -> review -> test-design -> unit-test -> test",
    );
  });

  it("allows switching to another workflow from the project catalog", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectWorkflowConfig(projectDir);
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("修复登录报错");
    await agent.handleUserInput(projectDir);
    const selectionLines = await agent.handleUserInput("n");

    expect(selectionLines).toContain("请从当前项目配置中改选其他 workflow：");
    expect(selectionLines).toContain(
      "1. feature-change-workflow：已有功能点的规则修改、页面适配或联动逻辑调整。",
    );

    const confirmLines = await agent.handleUserInput("1");

    expect(confirmLines).toContain("已切换为 workflow：feature-change-workflow。");
    expect(confirmLines).toContain(
      `请提供工件保存目录。直接回车将使用默认目录：${path.resolve(projectDir, ".aegisflow", "artifacts")}`,
    );

    await agent.handleUserInput("");
    const runtime = (agent as unknown as {
      runtime?: {
        projectConfig: {
          workflow: {
            name: string;
          };
          workflowPhases: Array<{
            name: string;
          }>;
        };
      };
    }).runtime;

    expect(runtime?.projectConfig.workflow.name).toBe("feature-change-workflow");
    expect(runtime?.projectConfig.workflowPhases.map((phase) => phase.name)).toEqual([
      "clarify",
      "explore",
      "plan",
      "build",
      "review",
      "test-design",
      "unit-test",
      "test",
    ]);
  });

  it("rejects malformed numeric workflow selection input", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeProjectWorkflowConfig(projectDir);
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("修复登录报错");
    await agent.handleUserInput(projectDir);
    await agent.handleUserInput("n");
    const lines = await agent.handleUserInput("1abc");

    expect(lines).toEqual([
      "无法识别 workflow 选择，请输入列表里的序号或 workflow 名称。",
    ]);
  });

  it("blocks startup when workflows config is invalid", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(path.join(projectDir, ".aegisflow"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".aegisflow", "aegisproject.yaml"),
      [
        "workflow:",
        '  type: "default-workflow"',
        "",
      ].join("\n"),
      "utf8",
    );
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("修复登录报错");
    const lines = await agent.handleUserInput(projectDir);

    expect(lines).toEqual([
      `项目 workflow 配置非法：当前仍使用旧的 workflow 单对象结构；本期必须改为 workflows 非空列表。 请修正 ${path.join(projectDir, ".aegisflow", "aegisproject.yaml")} 中的 workflows 配置。`,
    ]);
  });

  it("blocks startup when workflow names are duplicated", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await writeCustomWorkflowConfig(
      projectDir,
      [
        '  - name: "duplicate-workflow"',
        '    description: "第一套规则修改流程。"',
        "    phases:",
        '      - name: "clarify"',
        '        hostRole: "clarifier"',
        "        needApproval: false",
        '  - name: "duplicate-workflow"',
        '    description: "第二套规则修改流程。"',
        "    phases:",
        '      - name: "build"',
        '        hostRole: "builder"',
        "        needApproval: false",
      ],
    );
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("调整列表排序规则");
    const lines = await agent.handleUserInput(projectDir);

    expect(lines).toEqual([
      `项目 workflow 配置非法：workflows[1].name 重复：duplicate-workflow。 请修正 ${path.join(projectDir, ".aegisflow", "aegisproject.yaml")} 中的 workflows 配置。`,
    ]);
  });

  it("blocks startup when a workflow contains duplicated phase names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await writeCustomWorkflowConfig(
      projectDir,
      [
        '  - name: "duplicate-phase-workflow"',
        '    description: "构建并再次构建的错误配置。"',
        "    phases:",
        '      - name: "build"',
        '        hostRole: "builder"',
        "        needApproval: false",
        '      - name: "build"',
        '        hostRole: "builder"',
        "        needApproval: false",
      ],
    );
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("新增一个构建步骤");
    const lines = await agent.handleUserInput(projectDir);

    expect(lines).toEqual([
      `项目 workflow 配置非法：workflow duplicate-phase-workflow 的 phases[1].name 重复：build。 请修正 ${path.join(projectDir, ".aegisflow", "aegisproject.yaml")} 中的 workflows 配置。`,
    ]);
  });

  it("prefers the workflow whose description text matches more closely within the same task type", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await writeCustomWorkflowConfig(
      projectDir,
      [
        '  - name: "ui-adjustment-workflow"',
        '    description: "页面样式调整、按钮布局适配、文案展示优化。"',
        "    phases:",
        '      - name: "clarify"',
        '        hostRole: "clarifier"',
        "        needApproval: false",
        '  - name: "permission-rule-workflow"',
        '    description: "权限规则修改、审批条件调整、角色访问控制策略更新。"',
        "    phases:",
        '      - name: "clarify"',
        '        hostRole: "clarifier"',
        "        needApproval: false",
      ],
    );
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("调整审批权限规则和角色访问控制");
    const lines = await agent.handleUserInput(projectDir);

    expect(lines).toContain("推荐 workflow：permission-rule-workflow");
  });
});

async function writeProjectWorkflowConfig(projectDir: string): Promise<void> {
  await writeCustomWorkflowConfig(projectDir, [
      "workflows:",
      '  - name: "feature-change-workflow"',
      '    description: "已有功能点的规则修改、页面适配或联动逻辑调整。"',
      "    phases:",
      '      - name: "clarify"',
      '        hostRole: "clarifier"',
      "        needApproval: false",
      '      - name: "explore"',
      '        hostRole: "explorer"',
      "        needApproval: false",
      '      - name: "plan"',
      '        hostRole: "planner"',
      "        needApproval: true",
      '      - name: "build"',
      '        hostRole: "builder"',
      "        needApproval: false",
      '      - name: "review"',
      '        hostRole: "critic"',
      "        needApproval: true",
      '      - name: "test-design"',
      '        hostRole: "test-designer"',
      "        needApproval: false",
      '      - name: "unit-test"',
      '        hostRole: "test-writer"',
      "        needApproval: false",
      '      - name: "test"',
      '        hostRole: "tester"',
      "        needApproval: false",
      '  - name: "bugfix-workflow"',
      '    description: "已有问题修复、边界情况修复或回归问题修复。"',
      "    phases:",
      '      - name: "clarify"',
      '        hostRole: "clarifier"',
      "        needApproval: false",
      '      - name: "explore"',
      '        hostRole: "explorer"',
      "        needApproval: false",
      '      - name: "plan"',
      '        hostRole: "planner"',
      "        needApproval: true",
      '      - name: "build"',
      '        hostRole: "builder"',
      "        needApproval: false",
      '      - name: "review"',
      '        hostRole: "critic"',
      "        needApproval: true",
      '      - name: "test-design"',
      '        hostRole: "test-designer"',
      "        needApproval: false",
      '      - name: "unit-test"',
      '        hostRole: "test-writer"',
      "        needApproval: false",
      '      - name: "test"',
      '        hostRole: "tester"',
      "        needApproval: false",
      '  - name: "small-new-feature-workflow"',
      '    description: "较小范围的新功能点开发。"',
      "    phases:",
      '      - name: "clarify"',
      '        hostRole: "clarifier"',
      "        needApproval: false",
      '      - name: "explore"',
      '        hostRole: "explorer"',
      "        needApproval: false",
      '      - name: "plan"',
      '        hostRole: "planner"',
      "        needApproval: true",
      '      - name: "build"',
      '        hostRole: "builder"',
      "        needApproval: false",
      '      - name: "review"',
      '        hostRole: "critic"',
      "        needApproval: true",
      '      - name: "test-design"',
      '        hostRole: "test-designer"',
      "        needApproval: false",
      '      - name: "unit-test"',
      '        hostRole: "test-writer"',
      "        needApproval: false",
      '      - name: "test"',
      '        hostRole: "tester"',
      "        needApproval: false",
      "roles:",
      "  executor:",
      "    transport:",
      '      type: "child_process"',
      '      cwd: "."',
      "      timeoutMs: 300000",
      "      env:",
      "        passthrough: true",
      "    provider:",
      '      type: "codex"',
      '      command: "codex"',
      "",
    ]);
}

async function writeCustomWorkflowConfig(
  projectDir: string,
  lines: string[],
): Promise<void> {
  const contentLines = lines[0] === "workflows:" ? lines : ["workflows:", ...lines];
  await mkdir(path.join(projectDir, ".aegisflow"), { recursive: true });
  await writeFile(
    path.join(projectDir, ".aegisflow", "aegisproject.yaml"),
    contentLines.join("\n"),
    "utf8",
  );
}

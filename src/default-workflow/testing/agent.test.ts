import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntakeAgent } from "../intake/agent";

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
    await agent.handleUserInput("y");

    const lines = await agent.handleUserInput("取消任务");

    expect(lines).toEqual(["已取消当前任务创建流程。"]);
  });

  it("restores the interrupted task from the custom artifact directory after CLI restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "custom-artifacts");
    await mkdir(projectDir, { recursive: true });

    const firstAgent = new IntakeAgent(root);
    await firstAgent.handleUserInput("修复登录报错");
    await firstAgent.handleUserInput("y");
    await firstAgent.handleUserInput("y");
    await firstAgent.handleUserInput(projectDir);
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

  it("prints full workflow event identity fields in CLI output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("修复登录报错");
    await agent.handleUserInput("y");
    await agent.handleUserInput("y");
    await agent.handleUserInput(projectDir);
    const lines = await agent.handleUserInput("");

    const rendered = lines.join("\n");
    expect(rendered).toContain("[WorkflowEvent:progress]");
    expect(rendered).toContain("taskId=");
    expect(rendered).toContain("timestamp=");
    expect(rendered).toContain("TaskState 摘要：");
  });

  it("collects workflow orchestration before runtime initialization", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-agent-"));
    tempDirs.push(root);
    const agent = new IntakeAgent(root);

    await agent.handleUserInput("修复登录报错");
    const lines = await agent.handleUserInput("y");

    expect(lines).toEqual([
      "当前 workflow 编排将使用 default-workflow/v0.1：clarify -> explore -> plan -> build -> review -> test-design -> unit-test -> test。是否确认？请回答 yes/no。",
    ]);
  });
});

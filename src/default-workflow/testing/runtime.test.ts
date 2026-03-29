import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRuntimeForNewTask,
  buildRuntimeForResume,
} from "../runtime/builder";
import { TaskStatus } from "../shared/types";
import {
  createDefaultWorkflowOrchestration,
  createWorkflowSelection,
} from "../shared/utils";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("runtime builder", () => {
  it("rebuilds runtime from persisted snapshots instead of reusing the old instance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-runtime-"));
    tempDirs.push(root);
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(projectDir, ".aegisflow", "artifacts");

    await mkdir(projectDir, { recursive: true });
    const newRuntimeResult = await buildRuntimeForNewTask({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      orchestration: createDefaultWorkflowOrchestration(),
      description: "修复登录报错",
    });

    await newRuntimeResult.runtime.workflow.handleIntakeEvent({
      type: "start_task",
      taskId: newRuntimeResult.runtime.taskState.taskId,
      message: "修复登录报错",
      timestamp: Date.now(),
    });
    await newRuntimeResult.runtime.workflow.handleIntakeEvent({
      type: "interrupt_task",
      taskId: newRuntimeResult.runtime.taskState.taskId,
      message: "Interrupted by test.",
      timestamp: Date.now(),
    });

    const resumedRuntimeResult = await buildRuntimeForResume({
      projectConfig: newRuntimeResult.persistedContext.projectConfig,
      persistedContext: newRuntimeResult.persistedContext,
    });

    expect(resumedRuntimeResult.runtime.runtimeId).not.toBe(
      newRuntimeResult.runtime.runtimeId,
    );
    expect(resumedRuntimeResult.runtime.taskState.status).toBe(
      TaskStatus.INTERRUPTED,
    );

    await resumedRuntimeResult.runtime.workflow.handleIntakeEvent({
      type: "resume_task",
      taskId: resumedRuntimeResult.runtime.taskState.taskId,
      message: "继续执行",
      timestamp: Date.now(),
    });

    expect(resumedRuntimeResult.runtime.taskState.status).toBe(TaskStatus.RUNNING);
  });
});

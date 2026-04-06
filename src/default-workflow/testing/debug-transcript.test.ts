import { describe, expect, it } from "vitest";
import {
  buildTaskDebugTranscriptEntries,
  renderTaskDebugTranscript,
} from "../persistence/debug-transcript";
import type { TaskDebugEvent } from "../shared/types";

describe("task debug transcript", () => {
  it("keeps only user input, codex input, and codex output in transcript order", () => {
    const transcript = renderTaskDebugTranscript({
      debugEvents: [
        createDebugEvent("intake_message", 1, "Runtime 初始化成功。"),
        createDebugEvent("user_input", 2, "修复登录报错"),
        createDebugEvent("workflow_event", 3, "阶段开始"),
        createDebugEvent("executor_prompt", 4, "executor received final prompt", {
          payload: "FINAL_PROMPT",
        }),
        createDebugEvent("role_visible_output", 5, "builder 正在输出中间进度"),
        createDebugEvent("executor_stdout", 6, "raw stdout"),
        createDebugEvent(
          "executor_result_payload",
          7,
          "executor returned final raw payload",
          {
            payload: '{"summary":"done","artifacts":[]}',
          },
        ),
        createDebugEvent("executor_stderr", 8, "raw stderr"),
      ],
    });

    expect(transcript).toContain("# Task Debug Transcript");
    expect(transcript).toContain("## 1. User Input");
    expect(transcript).toContain("## 2. Codex Input");
    expect(transcript).toContain("## 3. Codex Output");
    expect(transcript).toContain("修复登录报错");
    expect(transcript).toContain("FINAL_PROMPT");
    expect(transcript).toContain('{"summary":"done","artifacts":[]}');
    expect(transcript).not.toContain("任务概览");
    expect(transcript).not.toContain("builder 正在输出中间进度");
    expect(transcript).not.toContain("raw stdout");
    expect(transcript).not.toContain("raw stderr");
    expect(transcript).not.toContain("Runtime 初始化成功");
  });

  it("marks empty codex outputs explicitly instead of falling back to process logs", () => {
    const entries = buildTaskDebugTranscriptEntries([
      createDebugEvent("user_input", 1, "继续"),
      createDebugEvent("executor_prompt", 2, "executor received final prompt", {
        payload: "PROMPT",
      }),
      createDebugEvent(
        "executor_result_payload",
        3,
        "executor returned final raw payload",
        {
          payload: "",
        },
      ),
      createDebugEvent("executor_stdout", 4, "should not be used"),
    ]);

    expect(entries).toEqual([
      {
        kind: "user_input",
        content: "继续",
      },
      {
        kind: "codex_input",
        content: "PROMPT",
      },
      {
        kind: "codex_output",
        content: "(empty output)",
      },
    ]);
  });

  it("preserves multiple I/O rounds in actual chronological order", () => {
    const entries = buildTaskDebugTranscriptEntries([
      createDebugEvent("user_input", 10, "第一次输入"),
      createDebugEvent("executor_prompt", 20, "executor received final prompt", {
        payload: "PROMPT_A",
      }),
      createDebugEvent(
        "executor_result_payload",
        30,
        "executor returned final raw payload",
        {
          payload: "OUTPUT_A",
        },
      ),
      createDebugEvent("user_input", 40, "第二次输入"),
      createDebugEvent("executor_prompt", 50, "executor received final prompt", {
        payload: "PROMPT_B",
      }),
      createDebugEvent(
        "executor_result_payload",
        60,
        "executor returned final raw payload",
        {
          payload: "OUTPUT_B",
        },
      ),
    ]);

    expect(entries.map((entry) => `${entry.kind}:${entry.content}`)).toEqual([
      "user_input:第一次输入",
      "codex_input:PROMPT_A",
      "codex_output:OUTPUT_A",
      "user_input:第二次输入",
      "codex_input:PROMPT_B",
      "codex_output:OUTPUT_B",
    ]);
  });
});

function createDebugEvent(
  type: TaskDebugEvent["type"],
  timestamp: number,
  message: string,
  overrides: Partial<TaskDebugEvent> = {},
): TaskDebugEvent {
  return {
    taskId: "task_debug_transcript_case",
    timestamp,
    type,
    source: "executor",
    message,
    ...overrides,
  };
}

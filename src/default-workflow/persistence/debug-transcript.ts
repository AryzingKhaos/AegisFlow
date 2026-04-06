import type { TaskDebugEvent } from "../shared/types";

export interface TaskDebugTranscriptEntry {
  kind: "user_input" | "codex_input" | "codex_output";
  content: string;
}

export function buildTaskDebugTranscriptEntries(
  debugEvents: TaskDebugEvent[],
): TaskDebugTranscriptEntry[] {
  return [...debugEvents]
    .sort((left, right) => left.timestamp - right.timestamp)
    .reduce<TaskDebugTranscriptEntry[]>((entries, event) => {
      switch (event.type) {
        case "user_input":
          entries.push({
            kind: "user_input",
            content: resolveEventText(event, "(empty input)"),
          });
          return entries;
        case "executor_prompt":
          entries.push({
            kind: "codex_input",
            content: resolveEventText(event, "(empty input)"),
          });
          return entries;
        case "executor_result_payload":
          entries.push({
            kind: "codex_output",
            content: resolveEventText(event, "(empty output)"),
          });
          return entries;
        default:
          return entries;
      }
    }, []);
}

export function renderTaskDebugTranscript(input: {
  debugEvents?: TaskDebugEvent[];
}): string {
  const entries = buildTaskDebugTranscriptEntries(input.debugEvents ?? []);

  return [
    "# Task Debug Transcript",
    "",
    ...(entries.length > 0
      ? entries.flatMap((entry, index) => [
          `## ${String(index + 1)}. ${getTranscriptEntryTitle(entry.kind)}`,
          "",
          "```text",
          entry.content,
          "```",
          "",
        ])
      : ["暂无 I/O 记录。", ""]),
  ].join("\n");
}

function getTranscriptEntryTitle(kind: TaskDebugTranscriptEntry["kind"]): string {
  switch (kind) {
    case "user_input":
      return "User Input";
    case "codex_input":
      return "Codex Input";
    case "codex_output":
      return "Codex Output";
  }
}

function resolveEventText(event: TaskDebugEvent, fallback: string): string {
  if (typeof event.payload === "string") {
    return event.payload.length > 0 ? event.payload : fallback;
  }

  if (typeof event.message === "string") {
    return event.message.length > 0 ? event.message : fallback;
  }

  return fallback;
}

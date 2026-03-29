import { describe, expect, it } from "vitest";
import { normalizeUserIntent } from "../intake/intent";

describe("normalizeUserIntent", () => {
  it("routes explicit continue wording to resume_task", () => {
    const intent = normalizeUserIntent("继续执行当前任务", true);

    expect(intent.type).toBe("resume_task");
  });

  it("routes additional context to participate when no explicit continue wording exists", () => {
    const intent = normalizeUserIntent("补充一下：问题发生在 OAuth 回调", true);

    expect(intent.type).toBe("participate");
  });

  it("guesses new task workflow types from natural language", () => {
    const intent = normalizeUserIntent("修复登录回调的空指针报错", false);

    expect(intent.type).toBe("new_task");
    expect(intent.taskType).toBe("bugfix");
  });

  it("treats phase orchestration requests as out_of_scope", () => {
    const intent = normalizeUserIntent("跳过 Clarify 直接 Build", false);

    expect(intent.type).toBe("out_of_scope");
  });
});

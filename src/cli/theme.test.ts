import { describe, expect, it } from "vitest";
import { compactSkeletonBody, resolveResultToneStyle, THEME } from "./theme";

describe("cli theme", () => {
  it("keeps separate token groups for result, skeleton, and intermediate content", () => {
    expect(THEME.result.title).not.toBe(THEME.skeleton.title);
    expect(THEME.skeleton.title).not.toBe(THEME.intermediate.title);
    expect(THEME.result.border).not.toBe(THEME.skeleton.border);
  });

  it("gives errors an isolated visual style from normal results", () => {
    const resultStyle = resolveResultToneStyle("result");
    const errorStyle = resolveResultToneStyle("error");

    expect(resultStyle.title).toBe(THEME.result.title);
    expect(errorStyle.title).toBe(THEME.error.title);
    expect(errorStyle.title).not.toBe(resultStyle.title);
  });

  it("maps system blocks to khaki text instead of secondary muted text", () => {
    const systemStyle = resolveResultToneStyle("system");

    expect(systemStyle.title).toBe(THEME.result.system);
    expect(systemStyle.body).toBe(THEME.result.system);
    expect(systemStyle.body).not.toBe(THEME.text.secondary);
  });

  it("compacts skeleton copy into fast-scan single lines", () => {
    expect(compactSkeletonBody("阶段开始\n\n角色开始")).toBe(
      "阶段开始 / 角色开始",
    );
  });
});

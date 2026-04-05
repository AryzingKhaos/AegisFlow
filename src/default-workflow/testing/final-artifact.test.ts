import { describe, expect, it } from "vitest";
import { normalizeFinalArtifactMarkdown, resolveFinalArtifactDefinition } from "../workflow/final-artifact";

describe("final artifact normalizer", () => {
  it("keeps readable markdown body and appends readable summary and metadata sections", () => {
    const output = normalizeFinalArtifactMarkdown({
      phase: "plan",
      roleName: "planner",
      artifactKey: "plan-planner-1",
      rawContent: "# Plan\n\nImplement the change.",
      summary: "当前计划可以继续推进。",
      metadata: {
        blockingQuestions: ["是否需要兼容旧接口？"],
        notes: ["本次先覆盖主链路。"],
      },
    });

    expect(output).toContain("# Plan");
    expect(output).toContain("## 文档摘要");
    expect(output).toContain("当前计划可以继续推进。");
    expect(output).toContain("## Blocking Questions");
    expect(output).toContain("是否需要兼容旧接口？");
    expect(output).toContain("## 补充说明");
    expect(output).toContain("本次先覆盖主链路。");
  });

  it("unwraps a full RoleResult JSON string into readable markdown", () => {
    const output = normalizeFinalArtifactMarkdown({
      phase: "clarify",
      roleName: "clarifier",
      artifactKey: "final-prd",
      rawContent: JSON.stringify({
        summary: "PRD 已整理完成。",
        artifacts: [
          "# PRD\n\n## Goal\n\nMake the workflow readable.",
        ],
        metadata: {
          openQuestions: ["是否需要覆盖 review 阶段？"],
          decision: "建议先覆盖最终主工件。",
        },
      }),
      summary: "外层 summary",
      metadata: {
        notes: ["外层 metadata 也需要保留。"],
      },
    });

    expect(output.startsWith("# PRD")).toBe(true);
    expect(output).toContain("## Goal");
    expect(output).toContain("## 文档摘要");
    expect(output).toContain("外层 summary");
    expect(output).toContain("## Open Questions");
    expect(output).toContain("是否需要覆盖 review 阶段？");
    expect(output).toContain("## 补充说明");
    expect(output).toContain("外层 metadata 也需要保留。");
    expect(output).toContain("## 结论");
    expect(output).toContain("建议先覆盖最终主工件。");
  });

  it("converts fenced json artifact content into structured markdown", () => {
    const output = normalizeFinalArtifactMarkdown({
      phase: "plan",
      roleName: "planner",
      artifactKey: "plan-planner-1",
      rawContent: [
        "```json",
        JSON.stringify({
          title: "Implementation Plan",
          blockingQuestions: ["缺少接口返回定义"],
          notes: ["需要先确认 schema"],
        }, null, 2),
        "```",
      ].join("\n"),
      summary: "计划存在阻塞项。",
    });

    expect(output).toContain("## Title");
    expect(output).toContain("Implementation Plan");
    expect(output).toContain("## Blocking Questions");
    expect(output).toContain("缺少接口返回定义");
    expect(output).toContain("## Notes");
    expect(output).toContain("需要先确认 schema");
    expect(output).toContain("## 文档摘要");
    expect(output).toContain("计划存在阻塞项。");
  });

  it("renders metadata white-list fields as readable markdown sections", () => {
    const output = normalizeFinalArtifactMarkdown({
      phase: "plan",
      roleName: "planner",
      artifactKey: "plan-planner-1",
      rawContent: "# Plan\n\nBody",
      summary: "summary",
      metadata: {
        blockingQuestions: [{ question: "是否保留旧字段", owner: "backend" }],
        openQuestions: ["是否补 migration"],
        notes: ["先不改历史数据"],
        recommendation: "当前不建议继续推进。",
        agentModel: "codex-5.4",
      },
    });

    expect(output).toContain("## Blocking Questions");
    expect(output).toContain("Question: 是否保留旧字段; Owner: backend");
    expect(output).toContain("## Open Questions");
    expect(output).toContain("是否补 migration");
    expect(output).toContain("## 补充说明");
    expect(output).toContain("先不改历史数据");
    expect(output).toContain("## 结论");
    expect(output).toContain("当前不建议继续推进。");
    expect(output).not.toContain("agentModel");
  });

  it("fails instead of passing through invalid json-looking content", () => {
    expect(() =>
      normalizeFinalArtifactMarkdown({
        phase: "plan",
        roleName: "planner",
        artifactKey: "plan-planner-1",
        rawContent: "```json\n{ invalid }\n```",
        summary: "bad",
      }),
    ).toThrow("Final artifact JSON normalization failed");
  });

  it("exposes the explicit final artifact rule for clarify and generic phases", () => {
    expect(resolveFinalArtifactDefinition("clarify", "clarifier")).toEqual({
      key: "final-prd",
      title: "final-prd",
      artifactIndex: 0,
    });
    expect(resolveFinalArtifactDefinition("plan", "planner")).toEqual({
      key: "plan-planner-1",
      title: "plan-planner-1",
      artifactIndex: 0,
    });
  });
});

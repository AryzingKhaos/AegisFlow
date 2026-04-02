# default-workflow-role-child-process-subcommand-review-fixes 实现说明

## 修改文件列表

- `src/default-workflow/workflow/controller.ts`
- `src/default-workflow/testing/runtime.test.ts`

## 改动摘要

- 收紧 `clarify` 阶段的 `metadata.decision` 校验：现在只接受 `ask_next_question` 或 `ready_for_prd`，缺失或拼写错误都会直接报错并使任务失败，不再默认兜底为 `ready_for_prd`。
- 收紧最终 PRD 生成落盘约束：最终生成调用现在必须满足 `artifactReady !== false`、`phaseCompleted !== false`，且必须返回非空 artifact；否则流程直接失败，不再用 `summary` 兜底拼装 `final-prd`。
- 补充回归测试，覆盖“非法 decision 导致 clarify 失败”和“最终 PRD 生成结果不可落盘时失败且不写入 final-prd”。

## 改动理由

- 原实现把除 `ask_next_question` 外的所有值都当成 `ready_for_prd`，会把模型漏字段或错误字段静默升级成“结束澄清”，风险过高。
- 原实现允许最终 PRD 生成在没有合法 artifact 的情况下继续落盘，会产生语义无效的 PRD 工件，与 `RoleResult` 的宿主判断契约不一致。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test -- --runInBand`
- 已做：`pnpm build`
- 已做：人工核对 `final-prd` 仅在最终生成调用返回可落盘 artifact 时才会写入。
- 未做：真实外部 `codex` CLI 联调。

# 实现说明

## 修改文件列表

- `src/default-workflow/persistence/debug-transcript.ts`
- `src/default-workflow/persistence/task-store.ts`
- `src/default-workflow/role/executor.ts`
- `src/default-workflow/shared/types.ts`
- `src/default-workflow/testing/debug-transcript.test.ts`
- `src/default-workflow/testing/runtime.test.ts`
- `src/default-workflow/testing/agent.test.ts`
- `src/default-workflow/testing/role.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-task-debug-transcript-codex-io-only.md`

## 改动摘要

- 新增 `src/default-workflow/persistence/debug-transcript.ts`，把 `debug-transcript.md` 渲染收敛成纯 I/O 转录器，只保留三类记录：`User Input`、`Codex Input`、`Codex Output`。
- 为 `TaskDebugEventType` 增加 `executor_prompt`，并在 `src/default-workflow/role/executor.ts` 里于真实执行前记录最终 prompt 原文，作为 transcript 中 `Codex Input` 的稳定来源。
- 保持 `executor_result_payload` 继续承担最终输出原文来源，transcript 中只消费该事件，不再回退到 `role_visible_output`、`stdout/stderr` 或 workflow/intake 噪音。
- 重写 `src/default-workflow/persistence/task-store.ts` 中的 transcript 生成路径，移除旧的任务概览、结果摘要、关键错误、时间线、原始输出附录和 runtime 文件清单，不再把 `debug-transcript.md` 当作综合 debug report。
- 新增 transcript 纯函数测试，并收敛 runtime/agent/role 既有测试，覆盖 prompt 原文保留、最终输出原文保留、空输出显式标记、旧大区块移除，以及 `debug-events.jsonl` 保真链路不受影响。

## 改动理由

- 本次需求收缩的是 `debug-transcript.md` 的职责边界，不是删除底层调试能力；因此实现重点必须放在“过滤和映射”，而不是删事件。
- 旧实现没有单独记录“真正发送给 codex 的最终 prompt”，导致 transcript 无法满足“codex 输入必须是具体值”的核心要求，所以补了一条最小事件 `executor_prompt`。
- 如果继续沿用旧的 transcript 汇总逻辑，即使删掉一部分区块，也仍会混入 workflow、transport 和过程输出，无法达到 PRD 要求的极简 I/O 结构。

## 未解决的不确定项

- 无。
- 补充说明：当前 transcript 的空状态会显示“暂无 I/O 记录。”；在某些纯 stub 或未经过真实 executor 的测试场景下，这是预期行为，不代表 `debug-events.jsonl` 缺失调试数据。

## 自检结果

- 已做：运行 `pnpm test -- src/default-workflow/testing/debug-transcript.test.ts src/default-workflow/testing/role.test.ts src/default-workflow/testing/runtime.test.ts src/default-workflow/testing/agent.test.ts`，Vitest 实际执行 11 个测试文件、108 个测试，全部通过。
- 已做：运行 `pnpm build`，`tsc` 编译通过。
- 已做：确认 `debug-events.jsonl` 仍保留 `workflow_event`、`role_visible_output`、`executor_stdout`、`executor_stderr`、`executor_exit` 等原有保真事件；本次只新增 `executor_prompt`，没有删减底层事件能力。
- 已做：确认改动只影响 transcript 渲染、executor 调试事件补点和相关测试，没有改动 task 状态持久化结构、`workflow-events.jsonl`、Intake UI 或 Workflow 主状态机语义。

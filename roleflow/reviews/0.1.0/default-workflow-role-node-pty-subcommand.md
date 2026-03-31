# default-workflow-role-node-pty-subcommand 审计报告

## 审计元信息

- 审计角色：Critic
- 审计范围：`default-workflow` 中 role 作为 `node-pty` 子命令行的运行时模型、active role 路由和 Intake 生命周期销毁
- 审计对象：当前 `git` 修改区代码
- 对照文档：
  - `roleflow/context/project.md`
  - `roleflow/clarifications/0.1.0/default-workflow-role-node-pty-subcommand-prd.md`
  - `roleflow/implementation/0.1.0/default-workflow-role-node-pty-subcommand.md`
- 验证方式：
  - 执行 `pnpm build`，通过
  - 执行 `pnpm test`，通过
  - 结合当前源码与测试做静态审计

---

## 关键问题

当前未发现需要阻塞本次提交的实现问题。

## 审计总结

- 已确认对齐：
  - 已引入 `node-pty` 驱动的持久 PTY terminal，会话不再退回到 `execa` 的一次性命令执行，位置见 `[executor.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/executor.ts#L245)`。
  - CLI 已补出独立的 live participation 快速通道，不再完全阻塞在主串行队列之后，位置见 `[index.ts](/Users/aaron/code/Aegisflow/src/cli/index.ts#L64)`、`[agent.ts](/Users/aaron/code/Aegisflow/src/default-workflow/intake/agent.ts#L165)`。
  - `Workflow` 已显式记录 active role，并通过 `sendInputToActiveRole()` 路由运行态输入，方向与新 PRD 一致，位置见 `[dependencies.ts](/Users/aaron/code/Aegisflow/src/default-workflow/runtime/dependencies.ts#L79)`、`[controller.ts](/Users/aaron/code/Aegisflow/src/default-workflow/workflow/controller.ts#L204)`。
  - 任务终态不再由 `Workflow` 立即 `disposeAll()`，role 会话会保留到 `Intake.dispose()` 统一回收，位置见 `[agent.ts](/Users/aaron/code/Aegisflow/src/default-workflow/intake/agent.ts#L182)`。
  - 上一轮关于 PTY 空闲退出后挂死的问题已修复：session 现在会进入 failed 态，后续执行与输入都会显式失败，位置见 `[executor.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/executor.ts#L273)`、`[role.test.ts](/Users/aaron/code/Aegisflow/src/default-workflow/testing/role.test.ts#L939)`。
  - 上一轮关于运行中误触发 `resume_task` 的问题已修复：运行态下会直接返回“当前任务正在执行中，无需恢复。”，不会再重跑 phase，位置见 `[agent.ts](/Users/aaron/code/Aegisflow/src/default-workflow/intake/agent.ts#L366)`、`[agent.test.ts](/Users/aaron/code/Aegisflow/src/default-workflow/testing/agent.test.ts#L194)`。
- 剩余问题统计：0。
- 整体评价：当前修改区与 `project.md`、PRD、计划文档的关键约束已经基本对齐。本轮静态审计未发现新的实现问题。

## 残余风险

- 当前测试已覆盖 PTY 复用、空闲退出失败态、active role 输入路由、任务终态保留会话、以及运行中拒绝错误恢复语义。
- 仍建议后续在真实 `node-pty + codex` 环境补一轮集成验证，确认不同 shell / 平台下 ready marker、退出码与 resume 链路行为一致。

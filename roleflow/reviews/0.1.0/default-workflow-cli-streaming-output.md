# default-workflow-cli-streaming-output 审计报告

## 审计元信息

- 审计角色：Frontend Critic
- 审计范围：提交 `e91ee57a90a6d5f8077251530b441de6a1d0ef91`
- 审计对象：`default-workflow` CLI 流式输出链路、Role 可见输出事件、Intake 转发与相关测试
- 验证方式：
  - 阅读提交 diff
  - 执行 `pnpm build`，通过
  - 执行 `pnpm test`，通过

---

# 关键问题（中风险）

## [功能缺口] 默认 Codex 角色并没有把执行中的真实内容流式输出到 CLI
- **位置**：`[model.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/model.ts#L55)`、`[model.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/model.ts#L78)`、`[executor.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/executor.ts#L23)`、`[runtime.test.ts](/Users/aaron/code/Aegisflow/src/default-workflow/testing/runtime.test.ts#L217)`
- **描述**：这次提交把 `role_output` 事件和 CLI 渲染链路接上了，但默认 Codex 角色在真实执行时只会发两类可见输出：
  1. 执行前的固定提示“角色 xxx 已开始执行”
  2. 执行完成后的最终 `summary`
  
  中间真正由 Codex 生成的分析、进度或阶段性结果并没有从 `[executor.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/executor.ts#L23)` 回传到 `emitVisibleOutput`。也就是说，默认角色在长时间执行期间仍然是静默的，CLI 只看到“开始”与“结束”，看不到执行中的真实内容。
- **触发条件**：任何走默认 `executeRoleAgent()` + `CodexCliRoleAgentExecutor` 链路的角色执行。
- **影响范围**：提交标题是“stream role output to CLI in real time”，但当前真正被验证的只是“自定义角色手工调用 `emitVisibleOutput` 时可以转发”。默认 Codex 角色主链路并没有完成真正的实时输出，用户体验仍然接近“等待角色结束后再看到结果”。
- **风险级别**：中
- **严重程度**：功能未达预期

## [并发串写] 角色执行结果缓存文件只按 `roleName` 命名，同项目并发运行会互相覆盖
- **位置**：`[executor.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/executor.ts#L27)`
- **描述**：`CodexCliRoleAgentExecutor` 把最终输出固定写到 `.aegisflow/runtime-cache/role-agent-${roleName}-last-message.txt`。该文件名只包含 `roleName`，不包含 `taskId`、运行轮次或随机隔离标识。
- **触发条件**：同一项目目录下同时运行两个相同角色，例如两个 `critic`、两个 `builder`。
- **影响范围**：后一个执行会覆盖前一个执行的输出文件；前一个执行随后回读时，可能读到另一条任务的最终消息，直接污染 `RoleResult` 和后续工件落盘。
- **风险级别**：中
- **严重程度**：结果错误

---

# 改进建议（低风险）

## [测试口径] 当前测试覆盖的是“手工可见输出透传”，没有覆盖默认 Codex 主链路的真实流式行为
- **位置**：`[runtime.test.ts](/Users/aaron/code/Aegisflow/src/default-workflow/testing/runtime.test.ts#L217)`、`[agent.test.ts](/Users/aaron/code/Aegisflow/src/default-workflow/testing/agent.test.ts#L78)`
- **描述**：当前测试主要验证：
  - 自定义测试角色手工调用 `context.emitVisibleOutput` 后，`role_output` 能否先于 `role_end` 出现
  - Intake/CLI 是否能把 `role_output` 渲染出来
  
  但没有测试默认 `executeRoleAgent()` + `CodexCliRoleAgentExecutor` 这条真实主链路是否真的能持续产生执行中输出。
- **影响范围**：当前测试全部通过，并不能证明“默认 Codex 角色正在实时输出”这个用户可感知目标已经达成。
- **风险级别**：低
- **类型**：可维护性

---

# 审计总结

- 问题统计：中风险 2 个，低风险 1 个
- 整体评价：CLI 侧事件渲染和输出转发链路已经接上，但默认 Codex 角色主链路的“真实实时输出”还没有闭环，并发场景下的结果缓存隔离也不够安全

# default-workflow-role-child-process-subcommand 审计报告

## 审计元信息

- 审计角色：critic
- 审计范围：`default-workflow` 的 `child_process` one-shot 角色执行链路、`clarify` 特殊流程、transport/provider 分层与相关测试
- 审计对象：当前 `git` 修改区代码
- 对照文档：
  - `roleflow/context/project.md`
  - `roleflow/clarifications/0.1.0/default-workflow-role-child-process-subcommand-prd.md`
  - `roleflow/implementation/0.1.0/default-workflow-role-child-process-subcommand.md`
- 验证方式：
  - 执行 `pnpm test -- --runInBand src/default-workflow/testing/runtime.test.ts`，通过
  - 执行 `pnpm build`，通过
  - 结合当前源码、测试与实现文档做静态审计

---

## 关键问题

### 1. [高风险] `clarify` 缺少对 `metadata.decision` 的严格校验，非法结果会被当成 `ready_for_prd`

- 位置：[`controller.ts`](/Users/aaron/code/Aegisflow/src/default-workflow/workflow/controller.ts#L773)
- 对照依据：[`default-workflow-role-child-process-subcommand.md`](/Users/aaron/code/Aegisflow/roleflow/implementation/0.1.0/default-workflow-role-child-process-subcommand.md#L84)
- 问题描述：
  - 计划文档要求 `clarifier` 返回结果必须显式表达 `decision = "ask_next_question" | "ready_for_prd"`。
  - 当前 `resolveClarifyDecision()` 只判断是否等于 `"ask_next_question"`；除此之外一律回落到 `"ready_for_prd"`。
- 影响：
  - 只要模型漏掉 `metadata.decision`、拼错值，或者返回了其他异常值，`Workflow` 就会直接进入最终 PRD 生成，而不是报错或继续等待澄清。
  - 这会让 `clarify` 阶段被提前结束，生成基于不完整问答的 PRD，属于流程语义错误。

### 2. [中风险] 最终 PRD 生成路径绕过了 `RoleResult` 约束，可能把 `summary` 当成 PRD 落盘并直接结束阶段

- 位置：[`controller.ts`](/Users/aaron/code/Aegisflow/src/default-workflow/workflow/controller.ts#L665)
- 对照依据：[`default-workflow-role-child-process-subcommand.md`](/Users/aaron/code/Aegisflow/roleflow/implementation/0.1.0/default-workflow-role-child-process-subcommand.md#L98)
- 问题描述：
  - 计划文档要求 `artifactReady` / `phaseCompleted` 真正进入 `Workflow` 消费链路。
  - 但 `generateClarifyPrd()` 里没有检查 `prdResult.artifactReady`、`prdResult.phaseCompleted`，并且在 `prdResult.artifacts[0]` 缺失时直接退化为 `buildClarifyFinalPrdArtifact(prdResult.summary)`。
- 影响：
  - 如果最终 PRD 生成这次调用返回了“不允许落盘”或“阶段未完成”的信号，当前实现仍会强行写出 `final-prd` 并继续 `completePhase()`。
  - 如果模型只返回了摘要、没有返回真正的 PRD artifact，系统会把摘要包装成 `# Clarify PRD` 落盘，得到一个格式上存在、语义上无效的 PRD 文件。

---

## 审计总结

- 已确认对齐：
  - 默认主链路已经切到 `child_process`，旧 `node-pty` 只保留在 [`node-pty.ts`](/Users/aaron/code/Aegisflow/src/default-workflow/role/retained/node-pty.ts)。
  - `RoleExecutorConfig` 已按 `transport + provider` 收敛，YAML 与默认值链路一致。
  - 普通 phase 已显式消费 `artifactReady` / `phaseCompleted`。
- 问题统计：高风险 1 个，中风险 1 个。
- 整体评价：主方向与 PRD/计划基本一致，但 `clarify` 的结构化路由与最终 PRD 落盘这两条关键闭环还不够严，当前不建议按“已完成闭环”认定。

## 残余风险

- 当前通过的测试主要验证了 one-shot 默认链路、配置解析和一般 phase 行为，但没有拦住本次 `clarify` 结果校验与最终 PRD 落盘约束缺失的问题。
- 未发现新增第三方依赖，因此不存在“这是一个新库”相关风险。

# default-workflow-workflow-layer 审计报告

## 审计元信息

- 审计角色：Frontend Critic
- 审计范围：`default-workflow` 的 `Workflow` 层状态机、phase 编排、恢复链路、工件与快照持久化、Intake 对接面
- 审计对象：当前 `git` 修改区代码
- 对照文档：
  - `roleflow/implementation/0.1.0/default-workflow-workflow-layer.md`
  - `roleflow/clarifications/0.1.0/default-workflow-workflow-layer-prd.md`
  - `roleflow/context/project.md`
- 验证方式：
  - 执行 `pnpm build`，通过
  - 执行 `pnpm test`，通过
  - 结合最小复现验证审批恢复、最终 phase 审批、失败状态收敛
- 额外核对：
  - 本次未引入新第三方依赖
  - 暂存代码新增注释为中文，符合项目约束

---

# 关键问题（高风险）

## [功能正确性] 审批恢复时，恢复指令文本会被直接当成下一阶段角色输入
- **位置**：`src/default-workflow/workflow/controller.ts:92`、`src/default-workflow/workflow/controller.ts:119`、`src/default-workflow/workflow/controller.ts:283`、`src/default-workflow/workflow/controller.ts:370`
- **描述**：`resume(taskId, input?)` 会先把恢复输入保存为 `latestInput`，然后把同一段 `input` 作为 `executeFromPhase` 的首个 `phaseInput` 传给恢复后的第一个 phase。结果是在 `waiting_approval` 场景下，像“批准继续”“继续执行”这样的控制语句，会直接成为 `builder`、`critic` 等后续角色的执行输入，而不是仅作为恢复信号。最小复现中，`plan` 结束等待审批后调用 `resume(taskId, "批准继续")`，`builder.run` 收到的入参就是 `"批准继续"`，而不是原始任务要求。
- **触发条件**：任务因审批停在 `waiting_approval`，用户随后通过 `resume_task` 恢复。
- **影响范围**：恢复后的首个角色会基于错误输入继续执行，直接破坏 `build` / `review` / `test-design` 等下游 phase 的语义基础，属于恢复链路核心行为错误。
- **风险级别**：高
- **严重程度**：功能失效

## [审批机制] 最后一个 phase 配置 `needApproval: true` 时会被直接完成，审批被跳过
- **位置**：`src/default-workflow/workflow/controller.ts:418`、`src/default-workflow/workflow/controller.ts:420`、`src/default-workflow/workflow/controller.ts:444`、`src/default-workflow/workflow/controller.ts:297`
- **描述**：当前审批判断绑定了 `needApproval && nextPhase`。这意味着只有“当前 phase 后面还有下一个 phase”时，系统才会进入 `waiting_approval`。如果最后一个 phase 本身要求审批，例如某个收尾 `review` 或 `test` phase 需要人工确认，代码会直接跳过等待态并将任务收敛为 `completed`。最小复现中，单 phase 配置 `{ name: "plan", needApproval: true }` 执行后，任务状态直接变为 `completed`。
- **触发条件**：流程最后一个 phase 配置了 `needApproval: true`。
- **影响范围**：PRD 明确要求审批是通用能力，不绑定固定 phase；当前实现会让尾部审批配置失效，导致审批链路不完整。
- **风险级别**：高
- **严重程度**：功能失效

---

# 次要问题（中风险）

## [状态一致性] 失败与取消路径没有收敛 `phaseStatus`，会留下 `failed + running` 的冲突状态
- **位置**：`src/default-workflow/workflow/controller.ts:247`、`src/default-workflow/workflow/controller.ts:581`
- **描述**：`cancel()` 和 `failWithError()` 都会把 `TaskStatus` 设为 `failed`，但不会同步收敛 `phaseStatus`。如果异常发生在 phase 执行中，最终会留下 `status=failed` 且 `phaseStatus=running` 的状态组合。最小复现中，角色抛错后 `TaskState` 最终为 `{"currentPhase":"clarify","phaseStatus":"running","status":"failed"}`。
- **触发条件**：角色执行异常，或任务在 phase 执行期间被取消。
- **影响范围**：直接违反 PRD 中“TaskStatus 与 PhaseStatus 必须保持一致”的要求；恢复判断、审计展示和后续状态机扩展都容易被这一冲突状态污染。
- **风险级别**：中
- **严重程度**：功能失效

---

# 改进建议（低风险）

## [测试覆盖] 当前测试没有覆盖恢复输入污染、尾 phase 审批和失败态 phaseStatus 一致性
- **位置**：`src/default-workflow/testing/runtime.test.ts:90`、`src/default-workflow/testing/runtime.test.ts:231`
- **描述**：现有测试覆盖了默认 phase 顺序、等待审批、等待输入、中断恢复和失败收敛，但没有断言“审批恢复时角色接收到的真实输入是什么”，也没有覆盖“最后一个 phase 需要审批”的场景，以及失败后 `phaseStatus` 是否仍残留为 `running`。
- **影响范围**：这三个问题都能在 `pnpm test` 全绿的情况下进入修改区，说明当前回归保护对状态机边界条件仍不够完整。
- **风险级别**：低
- **类型**：可维护性

---

# 不确定风险

- `latestInput` 在 `Workflow` 层中的语义目前有两种可能：一是“最近一次来自 Intake 的自由文本”，二是“下一个 host role 的执行输入”。当前实现同时把它当作两者使用，这是本次高风险问题的根源之一；但 PRD 没有把这两个概念拆开定义。
- `task-state.md` 当前被视为快照持久化产物，但是否也应该作为 `artifact_created` 事件的一部分暴露给 Intake，需求文档没有写死。

---

# 潜在技术债务

- `WorkflowController` 目前同时承担状态机推进、输入持久化、审批/恢复语义转换、日志广播和工件落盘，边界已经明显变重；后续继续补角色真实接入时，单类复杂度会快速上升。
- `latestInput`、`resumeFrom.currentStep` 和角色工件之间仍缺少明确职责分层，后续一旦引入真实角色，会更容易出现“控制信号误进业务输入”的问题。
- 快照、工件和事件三条持久化链路已经并行存在，但还没有统一索引或契约，后续排障和恢复来源判断成本会增加。

---

# 架构设计评估

- 本次改造在结构上比之前完整得多：`ProjectConfig.workflowPhases`、`run / resume / runPhase / runRole`、md 快照与角色注册表都已形成基本闭环。
- 主要问题集中在“状态机边界语义”而不是“有没有实现接口”。审批恢复、尾 phase 审批和失败状态收敛，都是边界判断错位，而不是缺少主干代码。
- 当前实现已经具备继续演进的骨架，但若不先收敛这些边界语义，后续真实角色接入只会把错误传播到更多 phase。

---

# 修复优先级

- **P0**：审批恢复把“批准继续”等控制语句当成下一阶段角色输入的问题
- **P0**：最后一个 `needApproval` phase 被直接完成的问题
- **P1**：失败/取消后 `phaseStatus` 仍保留为 `running` 的状态冲突问题
- **P3**：上述三类边界条件缺少自动化回归测试的问题

---

# 测试建议

- 增加“`plan` 等待审批 -> `resume_task('批准继续')` -> 校验 `builder.run` 输入”的测试，明确区分恢复控制信号与业务输入。
- 增加“单个 phase 且 `needApproval: true`”的测试，验证任务不会直接进入 `completed`。
- 增加失败与取消路径断言，检查 `phaseStatus` 不会在终止态下残留为 `running`。
- 增加 CLI 级联调用用例，验证 Intake 发出的“继续执行/批准继续”在 Workflow 层只触发恢复，不污染下游 role 输入。

---

# 审计总结

- 审计范围：`default-workflow` Workflow 层状态机、恢复链路、审批机制、快照与测试
- 问题统计：高风险 2 个，中风险 1 个，低风险 1 个
- 整体评价：本次 Workflow 层已经从占位控制器演进到了可运行的主状态机雏形，但审批与恢复边界仍存在关键语义错误，当前实现还不足以稳定承载真实 role 输入与审批恢复流程

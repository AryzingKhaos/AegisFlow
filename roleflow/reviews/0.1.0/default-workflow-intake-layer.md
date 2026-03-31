# default-workflow-intake-layer 审计报告

## 审计元信息

- 审计角色：critic
- 审计范围：`default-workflow` 的 `Intake` CLI 入口、意图识别、`Runtime` 装配、恢复链路、事件展示
- 审计对象：当前 `git` 暂存区代码
- 对照文档：
  - `roleflow/implementation/0.1.0/default-workflow-intake-layer.md`
  - `roleflow/clarifications/0.1.0/default-workflow-intake-layer-prd.md`
  - `roleflow/context/project.md`
- 验证方式：
  - 执行 `pnpm build`，通过
  - 执行 `pnpm test`，通过
  - 复验上次报告中的高风险问题
  - 结合 CLI 最小复现检查范围守卫行为
- 额外核对：
  - 新引入的 `@langchain/openai` 已存在于 `package.json`
  - 暂存代码未发现新增英文注释

---

# 已修复问题复验

- 上次报告中的“自定义工件目录恢复错误任务”已修复。当前实现通过 `cwd/.aegisflow/latest-task.json` 记录最近任务索引，并可在 CLI 重启后从自定义工件目录恢复正确 `taskId`。
- 上次报告中的“资料追问阶段无法取消任务”已修复。当前在 `pendingStep` 阶段会先识别控制指令，输入“取消任务”可直接结束创建流程。
- 上次报告中的“CLI 未完整展示 `WorkflowEvent` 信息”已修复。当前输出已包含 `taskId` 与 `timestamp`。
- 上次报告中的“超范围请求识别过窄”已部分处理，但新规则引入了新的误判问题，见下文。

---

# 关键问题（高风险）

## [功能正确性] 范围守卫正则过宽，正常的 Bugfix 描述会被误判为超范围请求
- **位置**：`src/default-workflow/shared/constants.ts:60`、`src/default-workflow/shared/constants.ts:61`、`src/default-workflow/shared/constants.ts:62`、`src/default-workflow/intake/intent.ts:89`
- **描述**：新增的超范围规则把 `跳过 Clarify 直接 Build` 这类越权诉求拦住了，但同时也会把“直接 build 就报错了”“test 直接失败了”这类正常问题描述一起判成 `out_of_scope`。原因是当前规则直接匹配 `直接 build/plan/critic/test`，没有区分“要求跳阶段编排”和“描述某个命令或阶段发生故障”这两类语义。实测输入“直接 build 就报错了”，CLI 会直接回复“敬请期待”。
- **触发条件**：用户用自然语言描述与 `build`、`test`、`plan` 等词相关的故障现象，且句子中包含“直接 build”“直接 test”等常见表达。
- **影响范围**：会错误拒绝本期明确支持的 `Bugfix` 任务，导致 Intake 把合法需求挡在入口层，属于支持范围内功能被错误拦截。
- **风险级别**：高
- **严重程度**：功能失效

---

# 次要问题（中风险）

- 当前未发现新的中风险问题。

---

# 改进建议（低风险）

## [测试覆盖] 新增了越权请求测试，但缺少“不要误伤正常故障描述”的反向用例
- **位置**：`src/default-workflow/testing/intent.test.ts:24`
- **描述**：现有测试只验证“跳过 Clarify 直接 Build”会被判为 `out_of_scope`，没有覆盖“直接 build 就报错了”“test 直接失败”这类应继续进入 Bugfix 流程的反向样例，因此本次误判可以在测试全部通过的情况下进入暂存区。
- **影响范围**：后续继续扩展意图规则时，类似误伤回归仍然容易再次出现。
- **风险级别**：低
- **类型**：可维护性

---

# 不确定风险

- 当前最近任务索引保存在 `IntakeAgent` 的 `cwd/.aegisflow/latest-task.json`。如果用户中断任务后从不同工作目录重启 CLI，恢复能力是否仍符合产品预期，当前 PRD 没有写清。
- `project.md` 与 PRD 中提到的“`workflow` 具体流程编排”是否仅指选择 `default-workflow`，还是还包括更细的流程配置项，当前实现仍未体现更多编排输入。

---

# 潜在技术债务

- 范围守卫继续依赖关键词和正则堆叠，随着“支持请求”和“越权请求”语义越来越接近，规则冲突和误判概率会继续升高。
- `IntakeAgent` 仍同时承担状态机、恢复索引、交互文案和事件展示，入口层复杂度在持续累积。

---

# 架构设计评估

- 当前架构比上次审计时更完整，恢复链路、待输入阶段控制指令和 CLI 事件展示都已经闭环。
- 这次主要问题不在分层本身，而在意图规则层。也就是入口层边界守卫虽然增强了，但分类机制仍过于词面化，缺乏对上下文语义的最小区分。
- 如果后续继续在 `OUT_OF_SCOPE_PATTERNS` 里直接叠加规则，类似“支持范围内故障描述被误杀”的问题还会继续出现。

---

# 修复优先级

- **P0**：正常 Bugfix 描述被误判为超范围请求的问题
- **P3**：缺少范围守卫反向测试样例的问题

---

# 测试建议

- 增加“直接 build 就报错了”“test 直接失败了”“plan 阶段生成文档异常”等描述型样例，验证它们不会被识别为 `out_of_scope`。
- 保留“跳过 Clarify 直接 Build”“帮我编排 phase”这类越权样例，形成正反两组回归测试。
- 增加 CLI 级用例，直接断言上述输入不会返回“敬请期待”。

---

# 审计总结

- 审计范围：`default-workflow` Intake 入口、恢复链路、范围守卫、事件展示与测试
- 问题统计：高风险 1 个，中风险 0 个，低风险 1 个
- 整体评价：上次指出的核心恢复问题和控制指令分流问题已修复，当前实现已明显更接近 PRD；但新增的范围守卫规则出现误伤，正在把一部分合法 Bugfix 需求挡在入口之外，仍需继续处理

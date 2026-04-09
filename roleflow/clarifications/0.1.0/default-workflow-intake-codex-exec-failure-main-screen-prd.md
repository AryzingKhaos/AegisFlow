# Default Workflow Intake Codex Exec Failure Main Screen PRD

## 文档信息

| 字段 | 内容 |
|------|------|
| 模块名 | `default-workflow-intake-codex-exec-failure-main-screen` |
| 本文范围 | `default-workflow` Intake UI 在 `codex exec` 执行中断时，必须把最终失败信息页提升为主屏幕主内容，而不是只显示“任务失败”提示 |
| 文档路径 | `roleflow/clarifications/0.1.0/default-workflow-intake-codex-exec-failure-main-screen-prd.md` |
| 直接使用者 | AegisFlow 开发者、Planner、Builder |
| 信息来源 | 用户新增需求、`src/cli/app.ts`、`src/cli/ui-model.ts`、`src/cli/output-layout.ts`、`src/default-workflow/workflow/controller.ts`、`src/default-workflow/intake/error-view.ts`、`src/default-workflow/role/executor.ts` |

## Background

用户新增要求是：

- 当 `codex exec` 在实际运行中中断时，例如网络异常、token 耗尽、额度耗尽或类似执行器侧中断
- 最终界面必须把失败信息页放到主屏幕上
- 不能让用户最后只看到“任务失败”这一类通用提示

基于代码阅读，可以确认当前链路已经具备“失败原因采集”的基础能力，但主屏幕展示优先级仍不足：

- `src/default-workflow/workflow/controller.ts` 的 `failWithError(...)` 会先发出 `error` 事件，再发出 `task_end: 任务执行失败。`
- `src/cli/ui-model.ts` 会把 `error` 事件转成 `currentError`
- `src/cli/app.ts` 会在主界面顶部渲染 `ErrorPanel`
- 但 `OutputPanel` / 主输出流仍继续保留失败骨架消息、任务结束消息和其他历史输出

这意味着当前体验更像是：

1. 主输出流仍然维持原本时间流
2. 额外加一个错误说明块
3. 用户仍有较大概率先看到“任务执行失败”“阶段执行失败”这类通用状态消息

对于 `codex exec` 中断场景，这种展示方式不够，因为用户真正最关心的是：

- 为什么这次执行中断了
- 是网络、额度、token、认证、transport 还是执行器失败
- 发生在什么阶段、哪个角色
- 下一步应该怎么做

因此，本 PRD 的目标不是再补一份普通错误块，而是要求主屏幕在 `codex exec` 中断时进入“失败信息页优先”模式，使失败原因成为阅读中心。

## Goal

本 PRD 的目标是为 `default-workflow` Intake UI 增加一套专门针对 `codex exec` 中断失败的主屏幕失败信息页需求，使系统能够：

1. 在 `codex exec` 中断时，把失败信息页提升为主屏幕主内容。
2. 让失败原因、失败位置、下一步建议成为用户第一眼看到的内容。
3. 避免主屏幕只剩“任务失败”“阶段执行失败”这类泛化口号。
4. 保持过程流、骨架流、历史输出仍可保留，但它们在失败后必须降级为次要内容。

## In Scope

- `codex exec` 中断失败时的 Intake 主屏幕展示策略
- 失败信息页在主输出区域中的优先级
- 失败摘要、失败原因、失败位置、下一步建议的最小展示要求
- `codex exec` 中断失败与普通骨架/状态流的主次关系
- 失败后主屏幕与过程输出区的收敛行为
- 对相关失败场景的验收测试要求

## Out of Scope

- 重写 Workflow 状态机
- 重写 `codex` 执行器
- 远程监控、重试队列或自动恢复机制
- Web 界面或图形化错误弹窗
- 所有错误类型统一重构为同一主屏失败页

## 已确认事实

- 当前 `failWithError(...)` 会发出 `error` 事件和 `task_end("任务执行失败。")`，见 `src/default-workflow/workflow/controller.ts`。
- 当前 `createIntakeErrorViewFromWorkflowEvent(...)` 会把 `event.message` 作为 `summary`，把 `metadata.error` 作为 `reason`，见 `src/default-workflow/intake/error-view.ts`。
- 当前 `OutputPanel` 仍以主输出流为中心展示历史消息，见 `src/cli/output-layout.ts` 和 `src/cli/app.ts`。
- 当前 `ErrorPanel` 是独立的顶部错误块，而不是主输出区中的主失败页。
- 当前 `codex exec` 失败时，执行器会抛出类似 `Role agent execution failed: ...` 的错误，并最终进入 Workflow 失败链路，见 `src/default-workflow/role/executor.ts`。
- 对网络问题、token 耗尽、额度耗尽、transport 中断等场景，用户最终最需要看到的是执行器失败原因，而不是通用的“任务失败”状态。

## 与既有 PRD 的关系

- 本文是对既有错误解释能力和 Intake UI 输出结构的补充澄清。
- 本文不覆盖 `default-workflow-intake-error-explainability-prd.md` 中“必须展示失败原因”的基本要求，而是进一步要求这些信息在 `codex exec` 中断时必须成为主屏幕主内容。
- 本文不覆盖 `default-workflow-intake-codex-style-output-stream-prd.md` 中“主输出流 + 运行态过程区”的整体方向，但要求在特定失败场景下，主屏幕阅读中心必须切换为失败信息页。
- 若“保持时间流连续”与“失败信息页必须成为主屏主内容”发生冲突，应以本文为准。

## 术语

### Codex Exec Interruption

- 指 `codex` 执行器在真实执行过程中发生中断、失败或异常退出。
- 典型示例包括但不限于：
  - 网络问题
  - token 耗尽
  - 额度耗尽
  - transport/provider 级失败
  - 执行器超时或异常中断

### Failure Main Screen

- 指主屏幕在失败后的主要阅读区域。
- 在本需求中，它不应继续由时间流中的通用失败口号占据，而应由结构化失败信息页占据。

### Final Failure Information Page

- 指失败后的主内容页。
- 它至少应包含：
  - 失败摘要
  - 直接失败原因
  - 失败位置
  - 下一步建议

## Functional Requirements

### FR-1 `codex exec` 中断时必须进入主屏幕失败页模式

- 当失败来源可判定为 `codex exec` 执行中断时，Intake 主屏幕必须切换到失败页优先模式。
- 此时用户第一眼看到的主内容必须是最终失败信息页。
- 不得继续让主输出流中的“任务执行失败”“阶段执行失败”成为主阅读中心。

### FR-2 最终失败信息页必须放在主输出区域的最高优先级位置

- 失败信息页必须出现在主屏幕主内容区域，而不是仅作为顶部附加块、侧边说明或次级区域存在。
- 它的视觉和结构优先级必须高于：
  - 主输出流中的骨架消息
  - 主输出流中的 `task_end`
  - 历史过程输出
- 用户不应需要先读一串历史消息才能看到失败原因。

### FR-3 最终失败信息页必须至少包含四类信息

- 失败摘要
- 失败原因
- 失败位置
- 下一步建议

以上四类信息在可推断时必须尽量完整显示，不能只剩摘要。

### FR-4 失败原因必须优先展示执行器中断的直接原因

- 对 `codex exec` 中断场景，失败原因不得只显示通用口号。
- 应优先展示最直接的执行器失败原因，例如：
  - 网络异常
  - token 耗尽
  - 额度耗尽
  - transport/provider 错误
  - 超时
  - 执行器返回异常
- 若当前系统只能拿到包装后的错误字符串，也必须优先展示该字符串，而不是退回到“任务失败”。

### FR-5 失败位置必须尽量包含阶段与角色

- 对运行时 `codex exec` 中断，失败信息页必须尽量展示：
  - phase
  - role
- 若能稳定判断是 `codex` 执行器链路，应允许在失败位置或失败原因中体现这是执行器侧中断。

### FR-6 下一步建议必须针对执行中断类失败

- 对网络问题、token 耗尽、额度耗尽、transport 失败等中断类问题，失败信息页应提供更有针对性的下一步建议。
- 不应只给出完全泛化的“请重试”。
- 至少应允许落到以下方向之一：
  - 检查网络或执行环境
  - 检查模型额度 / token 配额
  - 稍后重试
  - 修正配置后恢复或重新发起任务

### FR-7 失败后主输出流必须降级为次要信息

- 当主屏幕进入失败页模式后，主输出流中的历史消息仍可保留。
- 但这些历史消息必须退为次要内容，不能继续和失败页争夺主阅读中心。
- 失败后若仍显示主输出流，应位于失败页之后，或以明显次级方式呈现。

### FR-8 失败后过程输出区必须退出主阅读区

- 对 `codex exec` 中断导致的最终失败，`过程输出` 不应继续占据主屏幕主要位置。
- 失败后应默认隐藏过程区，或明确降级到失败页之后的次级位置。
- 不得让“运行中的过程区样式”在失败后继续误导用户。

### FR-9 通用失败口号可以保留，但不能成为唯一主内容

- `任务执行失败。`
- `阶段执行失败。`
- `Role agent execution failed.`

这类通用文案可以作为失败摘要的一部分保留，但不能成为主屏幕唯一可见内容。

### FR-10 失败页必须在任务终态后保持稳定可见

- 一旦任务进入失败终态，失败页必须稳定保留在主屏幕上。
- 不得因为随后到来的 `task_end`、状态刷新或骨架消息更新而被顶掉、清空或弱化。
- 直到用户输入新命令、重新发起任务或显式清理错误前，失败页都应保持可见。

### FR-11 必须覆盖实际中断类失败场景的验收测试

- 至少应覆盖以下场景：
  - transport/provider 错误导致的 `codex exec` 中断
  - 超时导致的 `codex exec` 中断
  - 执行器返回的额度 / token / 网络类错误字符串
  - 失败终态下主屏幕优先显示失败页，而不是只显示 `task_end`
- 测试重点应是“主屏幕信息优先级”，而不是仅验证 `currentError` 是否存在。

## 非功能要求

### NFR-1 可读性

- 用户打开失败后的主屏幕，必须能在第一屏快速看清失败原因。
- 不应需要滚动或阅读多条历史输出才能找到关键信息。

### NFR-2 稳定性

- 主屏失败页不应因正常终态事件、骨架事件或历史输出追加而闪烁或消失。

### NFR-3 与现有暗红主题一致

- 失败页可以使用现有错误态视觉语义。
- 但其提升为主屏主内容后，仍需与当前 Intake 暗红主题和 codex 风格输出框架保持一致。

## 验收标准

- 当 `codex exec` 因网络、token、额度、transport、超时等问题中断时，主屏幕第一眼展示的是结构化失败信息页，而不是仅“任务失败”。
- 失败信息页中可见失败摘要、失败原因、失败位置和下一步建议。
- `task_end("任务执行失败。")` 之类骨架消息不会继续成为主内容中心。
- 失败后过程输出区不会继续以运行态主区形式存在。
- 失败页在任务失败终态后稳定可见，不会被后续状态刷新顶掉。
- 自动化测试或等价校验能够识别“只剩任务失败口号、没有主屏失败页”的回归。

## Open Questions

- 无。

## Assumptions

- 用户本次重点要求的是 `codex exec` 中断类失败必须在主屏幕上前置展示，不要求本期把所有失败类型都统一重做为同等主屏失败页。
- 当前系统已有的 `summary / reason / location / nextAction` 错误模型可作为失败页的基础数据来源，不必重新发明另一套错误数据结构。

## Todolist (todoList)

- [x] 确认当前 `codex exec` 中断场景下用户仍可能只感知到“任务失败”。
- [x] 确认当前代码已有失败原因采集能力，但主屏幕优先级不足。
- [x] 明确新增需求聚焦“最终失败信息页必须进入主屏幕主内容”。
- [x] 明确失败页至少包含摘要、原因、位置、建议四类信息。
- [x] 明确历史输出和过程输出在失败后都必须降级为次要内容。
- [x] 明确需要新增针对中断类失败主屏展示优先级的防回退测试。


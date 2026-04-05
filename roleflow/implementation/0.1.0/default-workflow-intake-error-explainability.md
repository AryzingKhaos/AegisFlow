# Implementation Plan (implementationPlan)

## 概述 (summary)

- 本次实现聚焦 `default-workflow` 的 `Intake` 失败可解释性，目标不是新增更多失败点，而是把当前分散在 `WorkflowEvent(error)`、前置 `catch` 字符串和 Ink UI 普通结果块中的错误信息，收敛成统一、可定位、可操作的用户可见错误模型。
- 实现建议拆成 6 步：盘点失败来源与现有展示链路、定义统一错误视图模型、收敛前置失败与运行时失败映射、增强 Ink UI 错误区与视觉权重、补齐失败位置与下一步建议、补充关键错误场景测试。
- 最关键的风险点是继续维持“两套错误链路”：如果前置失败仍直接返回普通字符串、运行时失败仍只是普通 `finalBlock`，后续 UI 重构依然会再次弱化失败原因。
- 最需要注意的是“失败原因优先于失败状态”的产品语义必须真正落在当前 Ink 主链路上；不能仅依赖 `metadata.error` 存在，就假设用户已经看得清楚。
- 当前没有产品层未确认问题，但规范输入存在缺口：`roleflow/context/standards/common-mistakes.md` 缺失，`roleflow/context/standards/coding-standards.md` 为空；同时当前测试尚未覆盖错误解释能力的关键路径。

---

## 输入依据 (inputBasis)

- PRD：`roleflow/clarifications/0.1.0/default-workflow-intake-error-explainability-prd.md`
- 项目上下文：`roleflow/context/project.md`
- 计划模板：`roleflow/templates/plan/implementationPlan.md`
- 相关历史计划：`roleflow/implementation/0.1.0/default-workflow-intake-layer.md`
- 相关历史计划：`roleflow/implementation/0.1.0/default-workflow-intake-ink-ui.md`
- 当前 Intake 实现：`src/default-workflow/intake/agent.ts`
- 当前 Workflow 失败收敛：`src/default-workflow/workflow/controller.ts`
- 当前旧字符串格式化：`src/default-workflow/intake/output.ts`
- 当前 Ink UI 主入口：`src/cli/app.ts`
- 当前 Ink UI 视图模型：`src/cli/ui-model.ts`
- 当前 Ink UI 测试：`src/cli/ui-model.test.ts`
- 当前 Intake 测试：`src/default-workflow/testing/agent.test.ts`

缺失信息：

- `roleflow/context/standards/common-mistakes.md` 当前不存在，无法作为实现约束输入。
- `roleflow/context/standards/coding-standards.md` 当前为空，未提供可执行编码规范。
- 当前没有与本 PRD 对应的独立 exploration 工件；本计划只能基于 PRD、项目文档和现有代码状态生成。

---

## 实现目标 (implementationGoals)

- 新增统一的用户可见错误模型，让前置失败和运行时失败都以同一套结构进入 Intake UI，而不是继续一部分走普通字符串、一部分走 `WorkflowEvent(error)`。
- 修改当前 Ink UI 的错误展示方式，使失败原因、失败位置和下一步建议成为一等显示内容，而不是埋在普通结果块正文中。
- 保留 `WorkflowEvent(error).metadata.error` 作为运行时失败原因的主要来源，并确保当前主展示链路不会丢失或弱化它。
- 保持旧字符串展示链路和 `onWorkflowOutput` fallback 仍能稳定展示 `metadata.error`，避免只有 Ink 主界面可见错误详情而其他展示入口回退。
- 修改前置失败处理路径，使 `.aegisflow/aegisproject.yaml` 配置错误、项目目录错误、工件目录错误等启动前失败，也能进入统一错误语义，而不是只返回 `error.message`。
- 新增失败位置映射规则，至少覆盖 `phase`、`role`、配置文件路径和可判断的字段位置。
- 新增下一步动作建议的最小规则集，至少覆盖：修正配置后重试、检查目录、重新输入需求、恢复任务等常见路径。
- 保持 `WorkflowController` 作为运行时失败事实来源不变；本次重点是 Intake 层的错误模型、展示语义和验收测试，而不是整体重写底层错误采集。
- 最终交付结果应达到：用户在失败时不仅能看到“失败”，还能稳定看到“为什么失败、失败发生在哪、接下来怎么做”。

---

## 实现策略 (implementationStrategy)

- 采用“错误模型收敛 + UI 视图增强 + 前后链路统一”的局部改造策略，不推翻现有 Workflow 事件体系，而是在 Intake 展示链路上补一层统一错误语义。
- 先定义 `IntakeError` 或等价的 UI 可消费错误视图结构，显式表达至少四类字段：
  - `summary`
  - `reason`
  - `location`
  - `nextAction`
- 运行时失败优先从 `WorkflowEvent(error)` 归一化得到该结构，前置失败则通过 `IntakeAgent` 捕获并构造成同一结构，而不是继续直接返回字符串数组。
- 当前 `ui-model.ts` 中的 `error` block 需要从“普通 final block 的一种”升级为“错误优先视图输入”，使错误原因在布局和视觉层级上都高于骨架事件与通用失败口号。
- 错误位置的推导优先复用已有字段：`metadata.phase`、`metadata.roleName`、配置文件路径、当前 taskState；若缺字段，则采用保守默认值，但不能直接留空。
- 下一步建议采用规则驱动的最小映射，而不是追求一开始就覆盖所有错误：例如配置错误优先建议修正 `.aegisflow/aegisproject.yaml` 并重试，目录错误建议检查路径，运行中失败建议查看当前 phase/role 并视情况恢复或重新发起。
- 旧的 `formatWorkflowEventForCli()` 中“错误详情”格式化逻辑不能被视为废弃旁路；它仍属于 PRD 要求覆盖的旧展示链路，需要与 Ink 主链路一起守住 `metadata.error` 可见性。
- 因此实现应同时校对 `onWorkflowEvent -> ui-model` 主链路与 `onWorkflowOutput` / `formatWorkflowEventForCli()` fallback 链路，避免只修主界面、不修回退路径。
- 测试层优先覆盖配置失败、运行时 phase/role 失败、`metadata.error` 可见性、错误位置提示、以及 Ink UI 中错误块视觉优先级，而不是只测最终 `status=failed`。

---

## 实施流程图 (implementationFlowchart)

```mermaid
flowchart TD
    A[盘点前置失败与运行时失败来源] --> B[定义统一 IntakeError 视图结构]
    B --> C[将 WorkflowEvent(error) 与前置 catch 归一化]
    C --> D[增强 Ink UI 错误区与失败位置展示]
    D --> E[补充下一步动作建议规则]
    E --> F[补齐关键错误场景测试与文档]
```

---

## 当前实现差异与收敛项 (currentGapsAndConvergence)

- 当前 `src/default-workflow/workflow/controller.ts` 的 `failWithError()` 已会把真实错误写入 `WorkflowEvent(error).metadata.error`，说明失败原因采集并不是主要缺口。
- 当前 `src/default-workflow/intake/output.ts` 仍保留“错误详情”字符串格式化逻辑，但当前 Ink UI 主链路已改走 `src/cli/app.ts -> src/cli/ui-model.ts`，不再依赖旧 formatter。
- 当前 `IntakeAgent` 仍支持 `onWorkflowOutput(lines)` 这条旧展示出口；因此 `formatWorkflowEventForCli()` 不是纯历史遗留，而是实际仍可能被消费的 fallback 链路。
- 当前 `src/cli/ui-model.ts` 虽然会为 `event.type === "error"` 创建 `tone: "error"` 的 block，并把 `metadata.error` 拼进 body，但它仍属于 `finalBlocks` 的普通成员，没有单独的错误原因区、失败位置区或下一步动作区。
- 当前 `src/cli/app.ts` 会把 `finalBlocks` 和 `skeletonBlocks` 混在同一个输出区按顺序渲染，骨架事件与错误块会共同竞争用户注意力，缺少“错误原因优先”的明确策略。
- 当前 `IntakeAgent` 在部分前置失败路径中仍直接 `catch -> getErrorMessage(error) -> string[]` 返回，例如项目目录读取和 workflow catalog 读取失败时，这与运行时失败的 `WorkflowEvent(error)` 路径割裂。
- 当前 `getErrorMessage(error)` 只返回 `error.message` 或一个兜底通用句子，尚未表达失败位置、错误类型和下一步建议。
- 当前 `src/cli/ui-model.test.ts` 只覆盖了中间输出、结果输出、骨架事件等常规映射，没有覆盖错误详情、错误位置、下一步建议或错误视觉优先级。

---

## 错误模型收敛项 (errorModelConvergence)

- 需要为 Intake 主展示链路定义统一错误视图结构，至少表达：
  - `statusSummary`：失败状态或简短失败标题
  - `reason`：具体失败原因，优先使用 `metadata.error`
  - `location`：如 `phase`、`role`、配置文件路径、字段位置
  - `nextAction`：建议用户下一步做什么
- 对运行时失败，推荐从 `WorkflowEvent(error)` 映射该结构：
  - `statusSummary` 来自 event.message
  - `reason` 优先来自 `metadata.error`
  - `location` 来自 `metadata.phase`、`metadata.roleName`、taskState
- 对前置失败，推荐由 `IntakeAgent` 构造同一结构，而不是直接返回字符串；这样 Ink UI 不需要区分“错误是来自 Workflow 还是 Intake 前置逻辑”。
- 配置类错误至少应能指向 `.aegisflow/aegisproject.yaml`，并在可能时指出具体字段、列表项或不合法原因。
- 运行时约束失败，如 `artifactReady=false`、phase/role 执行失败等，应能明确说明失败发生在哪个阶段或角色，而不是只显示“执行失败”。

---

## UI 收敛项 (uiExplainabilityConvergence)

- Ink UI 中的错误展示不应只是普通 `[结果输出]` 的一个 body；至少需要单独错误标题、原因正文和位置/建议辅助区。
- 骨架事件如 `task_end`、`phase_end`、`role_end` 不应在视觉上压过错误原因本身；错误块应在排序或布局上保持更高可见性。
- 当 `metadata.error` 存在时，错误原因应优先显示，通用失败文案如“任务启动失败”“任务恢复失败”只能作为摘要存在。
- 当前 `ui-model` 中的 `buildErrorBody()` 可作为临时基础，但最终应扩展为更结构化的错误展示，而不是继续把所有信息拼成单个字符串 body。
- 系统消息路径如 `CLI 处理失败`、`CLI 实时透传失败` 也应尽量接入统一错误块语义，而不是继续只显示普通 muted 系统消息。
- 旧字符串链路中，`formatWorkflowEventForCli()` 与 `onWorkflowOutput` 的错误详情展示也必须同步守住；不能接受 Ink 主界面已有原因展示、但 fallback 输出退化成只剩“执行失败”。

---

## 验收目标 (acceptanceTargets)

- 失败时，用户不仅能看到失败状态，还能稳定看到失败原因。
- 当 `WorkflowEvent(error).metadata.error` 存在时，当前 Ink UI 主链路会稳定展示它，不会因 UI 重构被丢弃或弱化。
- 当 `WorkflowEvent(error).metadata.error` 存在时，旧字符串展示链路与 `onWorkflowOutput` fallback 也会稳定展示它，不会退化成只显示通用失败文案。
- 用户能够知道失败大致发生在哪个阶段、角色或配置文件位置，而不是只看到通用失败口号。
- 配置类错误会明确指出是配置问题，并在可能时提示 `.aegisflow/aegisproject.yaml` 路径和具体字段/列表项。
- 前置失败与运行时失败会通过同一套用户可见错误模型展示，不再一类走普通字符串、一类走错误事件。
- Ink UI 中错误原因具有明确视觉权重，骨架事件不会压过错误原因本身。
- 至少存在一组自动化测试或可执行验证，覆盖 workflow 配置非法、role/phase 执行失败、运行时约束失败和错误原因可见性。

---

## Todolist (todoList)

- [ ] 盘点 `IntakeAgent`、`WorkflowController`、`ui-model`、`app.ts` 中所有前置失败、运行时失败和系统级失败的现有展示路径。
- [ ] 盘点 `formatWorkflowEventForCli()`、`onWorkflowOutput` 和旧字符串 fallback 链路中的错误详情展示，明确这些旧入口仍属于必须守住的交付范围。
- [ ] 设计统一的 Intake 错误视图结构，至少覆盖失败摘要、失败原因、失败位置和下一步动作建议四类字段。
- [ ] 将 `WorkflowEvent(error)` 归一化为新的错误视图结构，优先消费 `metadata.error`、`phase`、`roleName` 等已有字段。
- [ ] 将 `IntakeAgent` 前置 `catch -> string[]` 路径收敛为统一错误模型输出，避免继续直接返回普通错误字符串。
- [ ] 为配置失败定义更明确的错误语义，至少能指向 `.aegisflow/aegisproject.yaml` 路径及相关字段或列表项。
- [ ] 为常见目录/路径失败定义位置与建议规则，至少覆盖目标项目目录、工件目录和恢复路径相关错误。
- [ ] 为运行时 phase/role 失败定义位置展示规则，确保用户能看到当前失败发生在哪个阶段和角色。
- [ ] 扩展 Ink UI 错误块或新增专门错误区，使错误原因、位置和建议在视觉上独立于普通结果块。
- [ ] 调整错误块与骨架事件的排序/布局策略，确保 `task_end` 等骨架事件不会压过错误原因。
- [ ] 收敛 `CLI 处理失败`、`CLI 实时透传失败` 等顶层异常显示方式，尽量纳入统一错误解释模型。
- [ ] 校对并必要时收敛旧字符串 formatter / `onWorkflowOutput` fallback 的错误展示，确保 `metadata.error`、失败位置和关键错误详情不会在旧链路中丢失。
- [ ] 为下一步动作建议定义最小规则集，至少覆盖修正配置后重试、检查目录、恢复任务、重新输入需求等路径。
- [ ] 更新或新增测试，覆盖 workflow 配置非法、role 执行失败、phase 执行失败、运行时约束失败、Ink UI 中 `metadata.error` 正确可见，以及旧字符串 / fallback 链路中的错误详情可见性。
- [ ] 补充手动验收清单，明确失败时应观察到的摘要、原因、位置和建议内容。
- [ ] 更新相关文档与示例，至少同步当前 Intake 主展示链路的错误解释策略，不再把旧字符串 formatter 视为唯一保障。
- [ ] 完成自检，确认本次改造没有弱化既有 `metadata.error` 可见性，也没有继续保留前置失败与运行时失败两套割裂的用户可见模型。

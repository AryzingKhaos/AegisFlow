# Default Workflow Intake Error Explainability PRD

## 文档信息

| 字段 | 内容 |
|------|------|
| 模块名 | `default-workflow-intake-error-explainability` |
| 本文范围 | `default-workflow` 中 `Intake` 对失败原因的展示、解释与定位能力 |
| 文档路径 | `roleflow/clarifications/0.1.0/default-workflow-intake-error-explainability-prd.md` |
| 直接使用者 | AegisFlow 开发者、Planner、Builder |
| 信息来源 | 用户问题、当前仓库实现代码、用户澄清结论 |

## Background

当前用户反馈为：`Intake` 层在失败时只展示“失败了”，但没有把“为什么失败”说清楚。  
阅读当前代码后，可以确认这不是单一层面的缺陷，而是由三层问题叠加造成的：

1. `Workflow` 层虽然会把失败原因写入 `error` 事件的 `metadata.error`，但失败主文案通常仍是“任务启动失败”“任务恢复失败”“阶段 X 执行失败”这类通用文案。
2. 旧的字符串渲染链路本来会显示“错误详情”，但当前 `Ink` UI 新链路已经绕过这条格式化链路，转而直接消费原始 `WorkflowEvent`。
3. 新的 `Ink` UI 没有把失败原因做成明确的错误说明视图，也没有为错误场景建立充分的验收测试，因此用户最终感知到的仍然主要是“失败状态”，而不是“失败原因”。

当前代码事实包括：

- `Workflow` 失败时会发出 `error` 事件，并将具体错误写入 `metadata.error`
- 旧的 `formatWorkflowEventForCli()` 会把该字段展示为“错误详情”
- 当前 `Ink` UI 改为通过 `onWorkflowEvent` + `ui-model` 直接渲染，不再复用旧的错误详情格式化输出
- `IntakeAgent` 某些前置失败路径会直接 `catch -> getErrorMessage(error)` 并作为普通字符串返回，缺少统一的错误语义分层
- `runtime/builder.ts` 中部分校验错误文案仍然偏泛化，例如 “Workflow configuration is missing or invalid.”

因此需要新增一份 PRD，把 `Intake` 的失败解释能力收敛成明确需求，而不是继续依赖各层临时拼接文案。

## 代码澄清结论

本轮澄清基于代码阅读得出的结论如下：

### 结论 1：失败原因并不是完全没有产生，而是在展示链路中没有被稳定强调

- `src/default-workflow/workflow/controller.ts` 中的 `failWithError(...)` 会把真实错误写入 `metadata.error`
- 这说明“失败原因采集”不是主要缺口
- 主要缺口在 `Intake` 的错误展示语义

### 结论 2：旧 CLI 字符串链路会展示错误详情，但当前 Ink UI 已绕过该链路

- `src/default-workflow/intake/output.ts` 会把 `metadata.error` 渲染为“错误详情”
- 但当前 `src/cli/app.ts` 使用 `onWorkflowEvent` 驱动 `src/cli/ui-model.ts`
- 也就是说，新的终端主界面不再直接依赖旧的 `formatWorkflowEventForCli()` 结果

### 结论 3：当前 Ink UI 没有建立“失败原因优先于失败状态”的展示策略

- `src/cli/ui-model.ts` 会生成错误块，但整体 UI 没有单独的失败原因区
- 同时 `task_end` 等骨架事件仍会继续进入视图
- 用户很容易先看到“任务执行失败”这种状态结果，而不是清晰的失败原因与修复指引

### 结论 4：前置失败与运行时失败的错误展示口径不统一

- 在 `src/default-workflow/intake/agent.ts` 中，某些前置失败直接返回字符串数组
- 在 `Workflow` 内部失败时，则通过 `WorkflowEvent(error)` 进入 UI
- 两类失败目前没有统一的用户可见错误模型，因此体验不一致

### 结论 5：当前缺少对错误解释能力的验收测试

- `src/cli/ui-model.test.ts` 当前没有覆盖错误详情展示的关键场景
- 这意味着即使错误详情再次被弱化或遗漏，也很难被测试及时发现

## Goal

本 PRD 的目标是明确 `default-workflow` 中 `Intake` 的失败解释需求，使系统能够：

1. 在失败时明确告诉用户“哪里失败了”。
2. 在失败时明确告诉用户“为什么失败了”。
3. 在可能的情况下告诉用户“下一步应该怎么做”。
4. 对前置失败、配置失败、运行时失败建立统一的用户可见错误语义。

## In Scope

- `Intake` 的失败展示语义
- `WorkflowEvent(error)` 的用户可见映射规则
- 前置失败与运行时失败的统一展示要求
- 错误原因、失败位置、修复建议的最小展示约束
- `Ink` UI 中错误视图的产品需求
- 错误场景的验收测试要求

## Out of Scope

- 具体实现代码修改
- `Role` 层 prompt 内容优化
- 所有底层错误消息的重写
- 日志文件格式设计
- Web UI 或图形界面错误页

## 已确认事实

- 当前用户能感知到失败状态，但不容易理解失败原因
- `Workflow` 失败链路中已经存在 `metadata.error`
- 旧字符串格式化链路可展示“错误详情”
- 当前 `Ink` UI 主链路已改为直接消费 `WorkflowEvent`
- 前置失败与运行时失败当前不是同一套用户可见模型

## 需求总览

```mermaid
flowchart LR
    ERR[底层错误]
    WF[Workflow / Intake 失败收敛]
    EVT[WorkflowEvent(error) / IntakeError]
    UI[Intake UI]
    U[CLI 用户]

    ERR --> WF
    WF --> EVT
    EVT --> UI
    UI --> U
```

## Functional Requirements

### FR-1 Intake 必须明确区分“失败状态”和“失败原因”

- `Intake` 在展示失败时，不能只展示“失败了”这一状态结果。
- 错误展示至少必须包含两层信息：
  - 失败状态
  - 失败原因
- 当失败原因存在时，失败原因的可见权重必须高于通用失败口号。

### FR-2 运行时失败必须稳定展示 metadata.error

- 当 `WorkflowEvent.type = error` 且存在 `metadata.error` 时，`Intake` 必须稳定展示该字段。
- `metadata.error` 不得因为 UI 重构而被静默丢弃、弱化或仅进入日志。
- 新旧展示链路都必须保证这一点。

### FR-3 Intake 必须展示失败位置

- 当失败来源可判断时，`Intake` 必须向用户展示失败位置。
- 失败位置至少应优先覆盖以下维度：
  - phase
  - role
  - 配置文件路径
- 目标是让用户知道错误发生在“哪一层、哪个阶段、哪个配置位置”。

### FR-4 配置失败必须明确指出是配置问题，而不是泛化成系统失败

- 当错误来源于 `.aegisflow/aegisproject.yaml`、workflow 配置或其他项目配置时，`Intake` 必须明确指出这是配置问题。
- 报错时必须尽量包含：
  - 配置文件路径
  - 具体字段或列表项
  - 为什么不合法
- 不应只展示“初始化失败”或“任务启动失败”这种泛化文案。

### FR-5 前置失败与运行时失败必须统一为同一套用户可见错误模型

- `IntakeAgent` 在启动前阶段直接捕获到的错误，不应只以普通系统消息字符串展示。
- `Workflow` 运行过程中产生的错误，也不应走另一套完全不同的视觉语义。
- 对用户而言，两类失败都应进入统一的错误解释模型。

### FR-6 错误展示应尽量提供下一步动作建议

- 在可判断的情况下，`Intake` 应告诉用户下一步该做什么。
- 至少包括以下类型：
  - 修正配置文件后重试
  - 恢复任务
  - 重新输入需求
  - 检查目标项目目录或工件目录
- 本期不要求覆盖所有错误类型，但必须把“失败后下一步怎么办”作为明确需求。

### FR-7 错误视图必须在 Ink UI 中单独成立

- 在 `Ink` UI 中，错误信息不能只是普通结果块的一种。
- 错误至少应具备单独的视觉语义，例如：
  - 单独标题
  - 更高对比度
  - 清晰的失败原因正文区
- 骨架事件如 `task_end` 不应在视觉上压过错误原因本身。

### FR-8 通用错误文案必须尽量减少无上下文表达

- 像“任务启动失败”“任务恢复失败”“执行失败”这类通用文案可以保留，但不能成为用户唯一可见信息。
- 当系统掌握更具体原因时，必须优先展示具体原因而不是仅展示通用失败文案。

### FR-9 关键错误场景必须具备验收测试

- 至少应为以下场景建立明确验收：
  - workflow 配置非法
  - role 执行失败
  - phase 执行失败
  - artifactReady=false 或同类运行时约束失败
  - Ink UI 中错误原因正确可见
- 若没有这些测试，错误解释能力不能视为稳定交付。

## Constraints

- 仅覆盖 `v0.1`
- 本文只描述需求，不展开代码实现
- 错误解释能力必须覆盖 `Intake` 当前主展示链路
- 不允许 UI 重构后弱化既有错误详情字段

## Acceptance

- 失败时，用户不仅能看到“失败”，还能看到“为什么失败”
- 当 `metadata.error` 存在时，用户能稳定看到它
- 用户能够知道失败大致发生在哪个阶段、角色或配置文件
- 配置类错误会明确指出是配置问题
- 前置失败与运行时失败的错误展示口径不再割裂
- `Ink` UI 中错误原因具有明确视觉权重
- 关键错误场景具备专门验收测试

## Risks

- 若继续维持两套错误展示链路，后续 UI 迭代仍会再次丢失错误原因
- 若只强调失败状态而不强调失败原因，用户会继续把系统感知为“只会报失败”
- 若缺少错误场景测试，后续重构极易回归

## Open Questions

- 是否需要在 `v0.1` 中把“修复建议”也标准化成结构字段，而不是依赖文案推断

## Assumptions

- 当前 `WorkflowEvent(error).metadata.error` 会继续作为运行时失败原因的主要来源

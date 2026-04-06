# Default Workflow Clarify Dialogue Artifact Reinjection PRD

## 文档信息

| 字段 | 内容 |
|------|------|
| 模块名 | `default-workflow-clarify-dialogue-artifact-reinjection` |
| 本文范围 | `default-workflow` 中 `clarify` 阶段每一次 one-shot 角色执行都必须显式注入 `initial-requirement` 与 `clarify-dialogue` 工件 |
| 文档路径 | `roleflow/clarifications/0.1.0/default-workflow-clarify-dialogue-artifact-reinjection-prd.md` |
| 直接使用者 | AegisFlow 开发者、Planner、Builder |
| 信息来源 | 用户新增需求、当前仓库实现代码、既有 clarify 相关 PRD |

## Background

`clarify` 阶段是一个高交互阶段，不同于 `explore`、`plan`、`build` 这类更偏单轮执行的阶段。  
在这个阶段里，`clarifier` 会经历多轮问答：

- 用户先给出初始需求
- `clarifier` 发起澄清问题
- 用户回答
- `clarifier` 再继续判断是否需要追问

当前系统的角色执行模型已经切换到 one-shot `child_process` 调用。  
这意味着每一次 `codex exec` 都是新的独立进程，不能依赖前一轮 CLI 进程记忆。

因此，如果新的 `clarify` 调用没有重新显式注入：

- `clarify/initial-requirement`
- `clarify/clarify-dialogue`

那么 agent 实际上不知道自己上一轮问了什么，也不知道用户上一轮答了什么。  
这会直接破坏 `clarify` 阶段多轮澄清的基本成立条件。

## 代码澄清结论

基于当前代码阅读，可以确认以下事实：

### 结论 1：`clarify` 阶段已经会落盘 `initial-requirement` 与 `clarify-dialogue`

- `src/default-workflow/workflow/controller.ts` 的 `runClarifyPhase()` 已经会维护：
  - `clarify/initial-requirement`
  - `clarify/clarify-dialogue`
  - `clarify/final-prd`

### 结论 2：当前 `clarify` 阶段的角色执行可见工件并没有把这些工件暴露回去

- 当前 `createExecutionArtifactReader()` 会调用 `resolveVisibleArtifactKeys(...)`
- 而 `resolveArtifactSourcePhases(phase)` 在 `phase === "clarify"` 时直接返回空数组
- 这意味着 `clarifier` 在 `clarify` 阶段执行时，当前默认拿不到 `clarify/initial-requirement` 和 `clarify/clarify-dialogue`

### 结论 3：当前实现和 one-shot 角色模型存在语义冲突

- 既有架构已经要求上下文原则上依赖工件，而不是 CLI 进程记忆
- 但 `clarify` 阶段当前又没有把最新问答工件显式重新注入给新一轮 one-shot 调用
- 这会导致“工件虽然写了，但下一轮没读到”的断裂

## Goal

本 PRD 的目标是明确 `clarify` 阶段的上下文重建要求，使系统能够：

1. 在 `clarify` 阶段的每一次 one-shot 角色调用前，显式把澄清历史工件重新注入执行上下文
2. 确保 `clarifier` 不依赖 CLI 进程记忆，而是依赖 `initial-requirement + clarify-dialogue`
3. 保证首轮提问、后续追问和最终 PRD 生成前的判断轮都使用同一套上下文来源

## In Scope

- `clarify` 阶段每轮 one-shot 调用的工件注入要求
- `initial-requirement` 与 `clarify-dialogue` 在 `clarify` 阶段中的执行时可见性
- `clarify` 阶段多轮问答的上下文延续约束
- 与最终 PRD 生成调用之间的上下文一致性要求

## Out of Scope

- 非 `clarify` 阶段的工件可见性设计
- 修改 `clarifier` 的提示词内容
- 重定义 `clarify-dialogue.md` 的 Markdown 格式
- 重新设计最终 PRD 的生成格式

## 已确认事实

- `clarify` 阶段是高交互阶段
- `clarify` 阶段使用 one-shot `codex exec` / 等价 provider 调用
- one-shot 调用不能依赖前一轮进程记忆
- `clarify-dialogue.md` 已经被设计为多轮问答历史工件
- 当前需求是：每一次新的 `clarify` 调用都必须把问答工件再次传进去

## Functional Requirements

### FR-1 `clarify` 阶段的每一次 one-shot 调用都必须显式注入澄清历史工件

- 只要当前 phase 仍是 `clarify`，每一次新的角色执行都必须显式带上：
  - `clarify/initial-requirement`
  - `clarify/clarify-dialogue`
- 这里的“每一次”包括：
  - 首轮提问判断
  - 后续追问判断
  - 用户回答后的继续判断
  - 进入最终 PRD 生成前的最后一次判断轮

### FR-2 `clarifier` 不得依赖 CLI 进程记忆维持上下文

- `clarifier` 不得假定上一轮 `codex exec` 还保留上下文
- `clarify` 阶段的上下文延续必须由工件注入保证，而不是由子进程或 provider session 保证

### FR-3 `clarify-dialogue` 必须在每轮执行前体现到最新状态

- 新一轮 `clarify` 角色调用开始前，执行上下文中可见的 `clarify-dialogue` 必须已经包含：
  - 历史问题
  - 历史回答
  - 刚刚落盘的最新轮次内容
- 不允许出现“文件已经写了，但本轮执行看不到最新版本”的状态

### FR-4 首轮调用也必须遵守同一上下文注入原则

- 即使是 `clarify` 阶段的首轮调用，也不能只给用户本轮输入
- 首轮调用至少必须看到：
  - `initial-requirement`
  - 当前可用的 `clarify-dialogue` 工件
- 若此时 `clarify-dialogue` 还为空，也应按统一机制处理，而不是走特殊隐式路径

### FR-5 最终 PRD 生成调用与澄清判断调用必须遵守同一上下文来源

- 当 `clarifier` 判断问答结束后，最终 PRD 生成调用也必须使用：
  - `clarify/initial-requirement`
  - `clarify/clarify-dialogue`
- 不允许最终 PRD 生成调用走另一套“只吃最后一轮输入”的路径

### FR-6 `clarify` 阶段的工件可见性必须区别于普通 phase

- 普通 phase 可以继续按既有“上一阶段最终工件”规则读取输入工件
- 但 `clarify` 阶段必须作为例外：
  - 角色执行时允许读取本 phase 下的 `initial-requirement`
  - 角色执行时允许读取本 phase 下的 `clarify-dialogue`
- 否则无法支撑多轮澄清

### FR-7 缺失澄清历史工件时必须视为执行上下文不完整

- 如果新的 `clarify` 调用没有读取到应有的 `initial-requirement` 或 `clarify-dialogue`
- 则不能把这种情况当作正常 one-shot 执行
- 系统应将其视为当前 `clarify` 上下文构建不完整的错误或约束违规

## Acceptance

- 文档明确规定 `clarify` 阶段每一次 one-shot 调用都必须显式注入 `initial-requirement` 与 `clarify-dialogue`
- 文档明确规定 `clarifier` 不得依赖 CLI 进程记忆
- 文档明确规定 `clarify` 阶段在工件可见性上是普通 phase 的例外
- 文档明确规定最终 PRD 生成调用与前面的澄清判断调用使用同一套工件上下文来源

## Risks

- 如果只在最终 PRD 生成时读取 `clarify-dialogue`，而前面的多轮澄清调用不读取，agent 会在问答过程中持续丢失上下文
- 如果继续让 `clarify` 阶段沿用普通 phase 的工件可见性规则，多轮问答机制会名义存在、实际失效
- 如果把这条约束只留在实现代码里而不写成独立 PRD，后续重构很容易回归

## Open Questions

- 无

## Assumptions

- `clarify/initial-requirement`
- `clarify/clarify-dialogue`

这两个工件会继续作为 `clarify` 阶段的稳定上下文输入物存在。

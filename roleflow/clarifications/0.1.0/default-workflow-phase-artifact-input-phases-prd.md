# Default Workflow Phase Artifact Input Phases PRD

## 文档信息

| 字段 | 内容 |
|------|------|
| 模块名 | `default-workflow-phase-artifact-input-phases` |
| 本文范围 | `default-workflow` 中 phase 工件输入来源的显式配置能力 |
| 文档路径 | `roleflow/clarifications/0.1.0/default-workflow-phase-artifact-input-phases-prd.md` |
| 直接使用者 | AegisFlow 开发者、Planner、Builder |
| 信息来源 | 用户新增需求、`roleflow/context/project.md`、`src/default-workflow/workflow/controller.ts`、现有 workflow 配置示例 |

## Background

当前 `default-workflow` 中，phase 之间的工件输入关系基本按“上一阶段工件传给下一阶段”处理。

从实际流程看，这个默认规则过于单一。用户已经明确指出：

- 某个阶段需要的输入工件，不一定只来自上一阶段
- 这种依赖关系应该是 workflow 可配置的，而不是代码写死
- 例如 `build` 阶段可能同时需要 `clarify` 和 `plan` 的工件
- 但某些更小、更直接的 workflow 中，`build` 也可能只需要 `plan` 工件，不需要 `clarify` 工件
- 当没有显式配置时，仍然可以保留现有默认行为：上一阶段工件传给下一阶段

这说明当前系统缺少一项明确的 workflow 配置能力：为每个 phase 声明“它需要读取哪些阶段的工件”。

## Goal

本 PRD 的目标是新增一份独立需求文档，明确 `default-workflow` 中 phase 工件输入来源的配置约束，使系统能够：

1. 允许 workflow 为某个 phase 显式声明其所需的上游阶段工件。
2. 保持未配置时的默认行为不变，即仍然按上一阶段工件传递。
3. 支持不同 workflow 对同名 phase 使用不同的工件依赖关系。
4. 让 `build`、`review`、`test-design` 等阶段不再被迫只消费上一阶段工件。
5. 在配置层、项目说明文档与后续实现中统一“phase 输入工件来源”的语义。

## In Scope

- `workflow.phases[*]` 新增工件输入来源字段
- phase 级工件输入来源的默认行为
- phase 输入工件来源的配置语义和示例
- 不同 workflow 对同名 phase 使用不同依赖集合的能力
- `project.md` 中 `PhaseConfig` 和 `aegisproject.yaml` 示例的同步更新

## Out of Scope

- 直接实现具体代码逻辑
- 重写已有历史任务工件
- 工件正文格式调整
- 工件内容结构、命名格式或落盘路径调整
- 精细到“某个具体 artifact key”级别的依赖声明

## 已确认事实

- 当前系统已有按 phase 管理工件的机制。
- 当前系统在 phase 间传递工件时，默认语义更接近“上一阶段传给下一阶段”。
- 这种默认语义不能覆盖所有 workflow。
- 用户明确要求把“当前 phase 需要哪些阶段的工件”做成可配置字段。
- 未配置该字段时，默认行为应保持为“上一阶段工件传给下一阶段”。
- 用户给出的最小样例是：
  - 某些 workflow 中，`build` 需要 `clarify` 和 `plan`
  - 某些 workflow 中，`build` 只需要 `plan`

## 与既有文档的关系

- 本文是新增 PRD，不覆盖既有 `workflow-layer`、`role-layer` 或工件输出相关 PRD。
- 既有文档中“phase 之间通过工件传递信息”的原则继续成立。
- 本文新增的是“这些工件来自哪些 phase”的显式配置能力。
- 若既有文档中仍存在“默认只读取上一阶段工件”的表述，应收敛为“默认行为”，而不是唯一行为。

## 术语

### Artifact Input Phases

- 指某个 phase 在执行时，需要读取哪些阶段的工件。
- 它描述的是 phase 级别的来源集合，而不是具体 artifact key。

### 默认输入来源

- 指当某个 phase 未显式配置工件输入来源时，系统采用的回退规则。
- 本期默认规则是：只读取上一阶段工件。

### 显式输入来源

- 指 workflow 在 phase 配置中明确声明工件来源阶段列表。
- 一旦配置，系统应优先按配置读取，而不是继续假定“只读上一阶段”。

## 需求总览

```mermaid
flowchart LR
    CFG[Workflow Phase Config]
    P[Current Phase]
    SRC[artifactInputPhases]
    AF[Upstream Phase Artifacts]

    CFG --> P
    CFG --> SRC
    SRC --> AF
    AF --> P
```

## Functional Requirements

### FR-1 `workflow.phases[*]` 必须支持声明工件输入来源阶段

- `workflow.phases[*]` 必须允许新增一个 phase 级字段，用于声明“当前 phase 需要读取哪些阶段的工件”。
- 该字段应表达 phase 列表，而不是单个字符串。
- 该字段应能在不同 workflow 中分别配置。

### FR-2 字段未配置时必须保持当前默认行为

- 若某个 phase 未配置工件输入来源字段，系统必须保持现有默认行为。
- 本期默认行为定义为：当前 phase 只读取上一阶段工件。
- 这个默认规则是回退规则，而不是唯一规则。

### FR-3 显式配置后必须优先于默认规则

- 若某个 phase 显式配置了工件输入来源字段，系统必须优先按该配置读取对应阶段工件。
- 显式配置后，不应再退回“只读上一阶段”的默认假设。
- 读取范围应由配置决定，而不是由 phase 相邻关系决定。

### FR-4 同名 phase 在不同 workflow 中必须允许有不同依赖

- 同一个 phase 名称在不同 workflow 中可以依赖不同的上游阶段工件。
- 例如：
  - 在完整交付 workflow 中，`build` 可以同时依赖 `clarify` 和 `plan`
  - 在更小范围 workflow 中，`build` 可以只依赖 `plan`
- 系统不得把某个 phase 的依赖关系写死为全局唯一规则。

### FR-5 字段语义必须是“阶段级工件来源”，而不是具体文件路径

- 新增字段必须表达“来自哪些 phase 的工件”。
- 本期不要求配置到具体 artifact key、具体文件名或具体路径。
- 具体阶段工件的选取规则仍由系统内部既有或后续规则决定。

### FR-6 `project.md` 必须更新配置示例与类型说明

- `roleflow/context/project.md` 中的 `PhaseConfig` 示例必须补充该字段。
- `project.md` 中的 `.aegisflow/aegisproject.yaml` 配置示例必须展示：
  - 未配置时使用默认上一阶段
  - 显式配置多个阶段来源
  - 显式配置单个非上一阶段来源
- `project.md` 中需要补充该字段的语义说明。

### FR-7 字段必须支持 `build` 同时读取 `clarify` 与 `plan`

- 系统配置必须能够表达：`build` 同时读取 `clarify` 与 `plan` 工件。
- 这是本次需求的核心验收样例之一。

### FR-8 字段必须支持 `build` 仅读取 `plan`

- 系统配置必须能够表达：`build` 只读取 `plan` 工件。
- 这说明 phase 工件依赖是 workflow 级可变关系，而不是固定流程模板。

## Constraints

- 不改变未配置时的默认上一阶段传递行为。
- 不要求本期支持 artifact key 级别的精细依赖声明。
- 不把 phase 工件输入来源能力写死到单一 workflow。
- 配置中的阶段名必须与实际 phase 名保持一致。
- 更新后的文档示例必须与 AegisFlow 当前目录和命名风格保持一致。

## Acceptance

- `project.md` 中的 `PhaseConfig` 已新增工件输入来源字段说明。
- `project.md` 的 `aegisproject.yaml` 示例已展示默认行为和显式配置行为。
- 文档可以清楚表达以下两种情况：
  - `build` 读取 `clarify + plan`
  - `build` 只读取 `plan`
- 文档明确“未配置时默认上一阶段，已配置时按配置优先”。
- 文档明确该能力是 workflow 级 phase 配置能力，而不是全局硬编码行为。

## Risks

- 若只在实现里新增逻辑、不在配置与文档中明确字段语义，后续使用者仍会误以为系统只支持上一阶段输入。
- 若把字段设计成具体 artifact 文件级别，当前需求会过早引入不必要复杂度。
- 若没有保留默认行为，现有依赖“上一阶段传递”的 workflow 可能出现兼容性问题。
- 若把 phase 依赖写死在代码里，不同 workflow 的表达能力仍然不足。

## Open Questions

- 字段名是否最终固定为 `artifactInputPhases`，还是需要在实现阶段根据现有命名风格再做统一收敛；本 PRD 先以 `artifactInputPhases` 作为推荐命名。

## Assumptions

- 当前用户要解决的是“阶段级工件来源配置”，不是“具体文件级工件路由配置”。
- 现有系统内部对每个 phase 最终工件的选取规则可以暂时沿用，本次先补 phase 来源声明能力。

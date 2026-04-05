# 实现说明

## 修改文件列表

- `src/default-workflow/shared/types.ts`
- `src/default-workflow/runtime/project-config.ts`
- `src/default-workflow/workflow/controller.ts`
- `src/default-workflow/testing/project-config.test.ts`
- `src/default-workflow/testing/runtime.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-phase-artifact-input-phases.md`

## 改动摘要

- 为 `WorkflowPhaseConfig` 增加 `artifactInputPhases?: Phase[]`，把 phase 级工件来源声明正式纳入运行时类型。
- 扩展 `project-config.ts` 的 workflow YAML 解析与校验，支持读取 `artifactInputPhases` 数组，并对字段类型、phase 名合法性、引用 phase 是否存在做显式校验。
- 进一步收紧 `artifactInputPhases` 校验，只允许引用当前 phase 之前的上游阶段，禁止引用自身或后续阶段。
- 为 `artifactInputPhases` 增加块状 YAML 数组解析支持，避免 `artifactInputPhases:\n  - clarify` 这类常见写法被静默降级成默认上一阶段行为。
- 重构 `WorkflowController.resolveVisibleArtifactKeys(...)`，把“上一阶段工件”收敛为默认回退规则；一旦 phase 显式配置 `artifactInputPhases`，就按该来源 phase 列表组合可见最终工件。
- 保持每个来源 phase 具体选哪份工件的现有规则不变，仍复用 `resolveFinalArtifactDefinition(...)`，本次没有扩展到 artifact key 级路由。
- 新增配置解析测试与 runtime 回归测试，覆盖 `build <- [clarify, plan]`、`build <- [plan]`、非法引用和非数组字段等场景。

## 改动理由

- 当前实现把 phase 工件输入关系基本写死为“上一阶段 -> 下一阶段”，无法表达不同 workflow 下同名 phase 的不同依赖。
- 用户要求的是 phase 级来源集合能力，而不是具体文件级路由，因此改动重点应放在配置解析和控制器来源 phase 解析，而不是重新设计 artifact key 规则。
- 为了兼容现有 workflow，未配置 `artifactInputPhases` 时仍保留默认上一阶段行为；只有显式配置时才覆盖默认逻辑。
- 如果不限制来源必须是上游阶段，非法配置会在运行时静默缺工件而不是尽早失败；这与“上游阶段工件来源”的约束不一致。
- 如果不支持块状 YAML 数组，用户使用常见 YAML 写法时会被静默回退到默认行为，风险高于直接报错。

## 未解决的不确定项

- `artifactInputPhases: []` 当前实现允许，语义为“该 phase 不读取任何上游阶段工件”，但仓库里尚无项目级实际 workflow 示例使用这一写法。
- 本次没有修改 `.aegisflow/aegisproject.yaml` 仓库默认示例，只补了运行时支持与测试覆盖。

## 自检结果

- 已做：运行 `pnpm test -- src/default-workflow/testing/project-config.test.ts src/default-workflow/testing/runtime.test.ts`，Vitest 实际跑了当前全套 8 个测试文件，`82` 个测试全部通过。
- 已做：运行 `pnpm build`，`tsc` 编译通过。
- 已做：确认 `WorkflowController` 仍只在 phase 级组合来源工件，没有扩展到 artifact key / 文件路径级配置。
- 已做：确认未配置 `artifactInputPhases` 时，既有“上一阶段工件”默认行为仍保留。
- 未做：没有补历史任务工件迁移，也没有增加 artifact key 级精细依赖能力。

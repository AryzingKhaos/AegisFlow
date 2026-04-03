# Default Workflow Intake Project Workflows 实现说明

## 修改文件列表

- `.aegisflow/aegisproject.yaml`
- `src/default-workflow/shared/types.ts`
- `src/default-workflow/shared/utils.ts`
- `src/default-workflow/shared/constants.ts`
- `src/default-workflow/runtime/project-config.ts`
- `src/default-workflow/runtime/builder.ts`
- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/testing/agent.test.ts`
- `src/default-workflow/testing/role.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-project-workflows.md`
- `roleflow/implementation/0.1.0/delivery/default-workflow-intake-project-workflows.md`

## 改动摘要

- 新增项目侧 workflow catalog 解析与校验能力，`Intake` 现在会从项目目录下 `.aegisflow/aegisproject.yaml` 的 `workflows` 列表读取可选 workflow。
- 新增非法配置阻断逻辑；当 `workflows` 缺失、沿用旧 `workflow:` 单对象结构、缺少 `description`、workflow 名重复、phase 名重复或 phase 字段非法时，会直接报错并要求修正项目配置。
- 重构 `IntakeAgent` 新任务链路，改为先收集目标项目目录，再基于 `workflow.description` 推荐 workflow，支持用户确认或从当前 catalog 中改选。
- 调整推荐算法，从“内置 task type 对齐”改为“description 文本匹配优先，task type 仅作弱辅助信号”，避免多个同类 workflow 时退化成按配置顺序推荐。
- 收敛 `WorkflowSelection` 结构，使其能够表达项目侧选中的 workflow；Runtime 初始化时使用 Selected Workflow 的 `phases` 作为真实编排输入。
- 更新项目配置示例为 `workflows` 复数结构，并补充自动化测试覆盖推荐、改选、非法配置阻断、唯一性校验和运行时写入。

## 改动理由

- PRD 明确要求 workflow 不能由代码写死，推荐来源必须唯一来自项目配置，因此需要移除 `Intake` 里基于内置三分类直接生成默认 workflow/phase 的旧路径。
- PRD 要求 `description` 成为推荐依据，并且非法配置不能静默降级，所以需要把项目配置读取、结构校验和错误语义前置到 Runtime 初始化之前。
- Runtime 只应消费用户最终确认后的 Selected Workflow，因此需要把 `workflow` 与 `workflowPhases` 的来源从 `Intake` 默认值切换到项目配置。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm install`
- 已做：`pnpm build`
- 已做：`pnpm test`
- 已做：确认 `Intake` 推荐来源来自 `.aegisflow/aegisproject.yaml`
- 已做：确认非法配置时不会继续进入任务启动
- 已做：确认重复 workflow 名与重复 phase 名会在 catalog 校验阶段阻断
- 已做：确认改选后的 workflow 会写入 Runtime 的 `projectConfig.workflow` 与 `workflowPhases`
- 已做：确认同类 workflow 共存时会优先选择 description 文本更贴近的 workflow
- 未做：真实大模型联机验证；当前仍以现有 stub/本地测试链路完成验证

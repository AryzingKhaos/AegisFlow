# default-workflow-intake-draft-retry-guards 实现说明

## 修改文件列表

- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/testing/agent.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-layer.md`
- `roleflow/implementation/0.1.0/default-workflow-intake-project-workflows.md`

## 改动摘要

- 修复 workflow 配置读取失败后的 Intake 状态回退：现在会回到 `collect_project_dir`，允许用户直接改正项目目录，而不是把后续输入继续当成需求描述。
- 修复默认值/相对 `artifactDir` 在更换 `projectDir` 后的重算逻辑，避免工件目录继续停留在旧项目路径。
- 收紧草稿收集阶段的 `resume_task` 控制语义：输入“恢复任务”或“继续执行当前任务”时不再清空当前 draft，而是明确提示用户先取消当前新任务创建流程。
- 新增回归测试覆盖上述两条场景，并同步更新 implementation Todolist。

## 改动理由

- review 指出的两个问题都是真实状态机缺口：一个会让用户无法修正 `projectDir`，另一个会静默丢失新任务草稿。
- 仅修改提示文案不够；如果不同时修正 `artifactDir` 的重算，用户改正项目目录后仍可能把工件写入旧项目，行为依然错误。
- `resume_task` 在 pending 收集阶段属于高风险控制指令，必须显式阻断，而不是复用运行中任务的恢复语义。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test -- src/default-workflow/testing/agent.test.ts`
- 已做：`pnpm build`
- 已做：人工核对 `recommendWorkflowForDraft()` 失败后的 pending step、`artifactDir` 重算和 draft 保留逻辑。
- 未做：真实 CLI 交互下的端到端手动演练。

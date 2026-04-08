# Default Workflow Intake Initial Requirement Bootstrap 实现说明

## 修改文件列表

- `src/default-workflow/shared/types.ts`
- `src/default-workflow/runtime/builder.ts`
- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/workflow/controller.ts`
- `src/default-workflow/workflow/clarify-artifacts.ts`
- `src/default-workflow/testing/runtime.test.ts`
- `src/default-workflow/testing/agent.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-initial-requirement-bootstrap.md`
- `roleflow/implementation/0.1.0/delivery/default-workflow-intake-initial-requirement-bootstrap.md`

## 改动摘要

- 重排 `IntakeAgent` 新任务启动链路：首轮输入改为 `requirementTitle`，先收工件目录和项目目录，再基于标题推荐并确认 workflow。
- 将 workflow 确认后的动作从“直接 init/start”改为“先 bootstrap Runtime 并创建稳定 task 目录”，随后显式等待第二轮“详细描述或 PRD 路径”输入。
- 新增 `clarify-artifacts.ts`，统一生成 `initial-requirement.md` 与 `clarify-dialogue.md`；`Intake` 在正式执行前写入 `tasks/<taskId>/artifacts/clarify/initial-requirement.md`。
- 扩展 `PersistedTaskContext` 与 Runtime 输入结构，增加 `requirementTitle`、`initialRequirementInput`、`initialRequirementInputKind`、`awaitingInitialRequirement`，使 bootstrap 态可持久化、可恢复。
- 调整 `WorkflowController.runClarifyPhase(...)`：`Clarify` 不再兜底补写 `initial-requirement.md`；缺失时直接报错，`clarify-dialogue` 只允许在首轮进入 Clarify 时初始化。
- 收敛 `initial-requirement.md` 内容语义：无论详细描述还是 PRD 路径，落盘内容都只记录用户该轮输入本身；PRD 路径场景不再额外包裹标题或元数据。
- 收敛 PRD 路径识别规则：显式路径标记仍直接识别为 `prd_path`；仅文件名场景要求该 markdown 文件已实际存在于当前 task 目录内，既支持 `需求说明 (最终).md`、`input prd.md` 这类合法文件名，也避免把自然语言句子误判成路径。
- 将 `initialRequirementInputKind` 作为最小只读字段透传给角色执行上下文，保证 Clarify 角色在只读工件之外仍能显式区分“详细描述文本”和“PRD 路径”。
- 调整第二轮输入后的启动透传，`init_task` / `start_task` 会复用真实初始需求输入，避免 `latestInput` 被空字符串覆盖。
- 更新 `agent` / `runtime` 测试，覆盖标题驱动推荐、bootstrap 后再收第二轮输入、任务目录提前创建、恢复 bootstrap 态、工件预写入以及 Clarify 首轮消费预写入工件。

## 改动理由

- PRD 要求把第一轮输入从“完整需求草稿”收敛成“仅标题”，因此 `Intake` 必须拆出两段式输入语义，而不能继续复用旧的 `description` 流程。
- 用户需要在正式启动前就拿到稳定的 task 目录，把 PRD 文件放进去再引用，所以 taskId 与 task 目录必须在 workflow 确认后立即落盘。
- `initial-requirement.md` 是 Clarify 的输入前提，若仍由 Clarify 首轮补写，就无法满足“先建 task、再补 PRD、最后启动 workflow”的目标链路。
- bootstrap 态如果没有显式持久化表达，CLI 重启后会误把“未正式启动但已建 task”的任务当成普通可恢复运行态，因此需要新增等待初始需求的上下文字段。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test src/default-workflow/testing/agent.test.ts src/default-workflow/testing/runtime.test.ts`
- 已做：`pnpm test`
- 已做：确认 workflow 推荐已改为基于标题，而不是完整需求正文
- 已做：确认 workflow 确认后先创建 `tasks/<taskId>/`，再等待第二轮输入
- 已做：确认 `initial-requirement.md` 在 `init_task` / `start_task` 前由 Intake 写入
- 已做：确认 bootstrap 后未正式启动的任务可被恢复，并继续停留在“等待详细描述或 PRD”阶段
- 已做：确认 PRD 路径输入写入的 `initial-requirement.md` 只包含路径本身
- 已做：确认仅文件名形式的 markdown 相对路径会识别为 `prd_path`
- 已做：确认带空格或括号的文件名式 markdown 路径，在 task 目录内文件存在时会识别为 `prd_path`
- 已做：确认自然语言句子即使以 `.md` 结尾，也不会被误判成 `prd_path`
- 已做：确认 Clarify 角色上下文可读取 `initialRequirementInputKind`
- 已做：确认第二轮输入写入后 `latestInput` 会保持为该输入，而不会被后续空消息覆盖
- 未做：真实大模型联机执行验证；当前自检基于本地测试与 stub 执行链路

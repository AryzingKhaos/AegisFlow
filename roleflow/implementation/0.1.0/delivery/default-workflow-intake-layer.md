# default-workflow intake layer 实现说明

## 修改文件列表

- `src/index.ts`
- `src/cli/index.ts`
- `src/shims/node.d.ts`
- `src/default-workflow/index.ts`
- `src/default-workflow/shared/types.ts`
- `src/default-workflow/shared/constants.ts`
- `src/default-workflow/shared/utils.ts`
- `src/default-workflow/intake/config.ts`
- `src/default-workflow/intake/model.ts`
- `src/default-workflow/intake/intent.ts`
- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/persistence/task-store.ts`
- `src/default-workflow/runtime/dependencies.ts`
- `src/default-workflow/runtime/builder.ts`
- `src/default-workflow/workflow/controller.ts`
- `src/default-workflow/testing/intent.test.ts`
- `src/default-workflow/testing/runtime.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-layer.md`

## 改动摘要

- 新增 `default-workflow` Intake 层完整源码，包含 CLI 入口、`IntakeAgent`、意图识别、`workflow` 轻决策、资料追问、`Runtime` 装配、事件桥接与持久化恢复。
- 按计划文档要求接入 `@langchain/openai` 的 `ChatOpenAI`，固定默认值为 `gpt5.4`、`https://co.yes.vg/v1`、`process.env.OPENAI_API_KEY`，并实现环境变量优先级解析。
- 新增最小可运行的 `WorkflowController`、`ArtifactManager`、`EventLogger`、`RoleRegistry`，其中下游执行能力保持受控占位，但不会阻塞 CLI 启动和基础任务流转。
- 实现 `init_task`、`start_task`、`participate`、`interrupt_task`、`resume_task`、`cancel_task` 的构造、发送、展示与快照落盘。
- 新增恢复逻辑：从工件目录读取任务上下文与 `TaskState` 快照，重新装配 `Runtime` 后再触发 `resume_task`，避免复用旧内存实例。
- 补充最小自动化测试，覆盖意图分流和 Runtime 重建。

## 改动理由

- 当前仓库缺少任何业务运行时代码，只存在模板模块，因此必须从零搭建 Intake 最小闭环，才能满足“可直接启动验收”的交付要求。
- 将模型初始化、意图识别、运行时装配、控制器、持久化和 CLI 分层拆开，可以保证 Intake 只承担入口交互和轻决策，不把 phase 编排逻辑塞进入口层。
- 通过把 `TaskState` 更新集中在 `WorkflowController` 内，可以满足 `TaskState` 只能由工作流控制器合法推进的约束。
- 增加持久化快照和恢复构建能力，是满足 `control + C` 中断恢复、且恢复时必须重建 `Runtime` 的必要条件。
- 为当前缺失的 Node 类型提供最小本地声明，是为了在不新增依赖的前提下让现有工程可编译、可运行。

## 未解决的不确定项

- `WorkflowController` 目前只实现 Intake 层验收所需的最小事件闭环，未实现真正的 Clarify/Plan/Build 等 phase 编排，这部分仍属于后续能力。
- `RoleRegistry`、`EventLogger`、`ArtifactManager` 虽已可工作，但仍是偏轻量的 v0.1 受控实现，不代表最终生产形态。
- `IntakeAgent` 当前对任务类型和意图的识别主要依赖规则判断，未实际调用 LLM 做语义分类；模型接入已初始化，但未在本期把推理链扩展到真实在线分类。

## 自检结果

- 已做：
- 执行 `pnpm build`，确认 TypeScript 编译通过。
- 执行 `pnpm test`，4 个测试全部通过。
- 使用 `OPENAI_API_KEY=dummy node dist/cli/index.js` 做手动冒烟，验证首次启动、任务创建、资料追问、事件展示、补充输入、取消任务。
- 使用交互式会话验证 `control + C` 中断、`继续执行` 恢复，以及恢复后 `Runtime` 重新创建。

- 未做：
- 未接入真实可用的远程模型服务验证在线调用，因为本期实现只要求模型初始化成功且当前环境下无需发起网络请求。
- 未实现完整下游 phase 执行链路，因此没有进行 Clarify/Plan/Build 全流程验收。

## 手动验收清单

1. 设置 `OPENAI_API_KEY` 后执行 `pnpm build`。
2. 执行 `node dist/cli/index.js`，确认 CLI 正常启动并显示模型初始化信息。
3. 输入自然语言需求，例如“修复登录报错”，确认 CLI 会猜测任务类型并要求确认。
4. 按提示确认 `workflow`、项目目录和工件目录，确认系统完成 `Runtime` 初始化并展示 `WorkflowEvent` 与 `TaskState` 摘要。
5. 在任务运行态输入补充说明，确认被识别为 `participate`，并看到对应 `progress` 事件。
6. 运行态按 `control + C`，确认被映射为 `interrupt_task`，`TaskState` 进入 `interrupted`，且显示 `resumeFrom`。
7. 输入“继续执行”或“恢复任务”，确认系统重建 `Runtime` 并发送 `resume_task`。
8. 输入超范围请求，例如“帮我做图形界面后台”，确认统一回复“敬请期待”。

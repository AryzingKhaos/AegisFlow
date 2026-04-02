# default-workflow-intake-ink-ui 实现说明

## 修改文件列表

- `src/cli/index.ts`
- `src/cli/app.ts`
- `src/cli/ui-model.ts`
- `src/cli/ui-model.test.ts`
- `src/default-workflow/intake/agent.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-ink-ui.md`
- `roleflow/implementation/0.1.0/delivery/default-workflow-intake-ink-ui.md`

## 改动摘要

- 将 CLI 根入口从 `readline + stdout` 逐行打印切换为 `Ink + React` 渲染入口，新增 `runCliApp()` 与 `IntakeInkApp`。
- 新增 `src/cli/ui-model.ts`，把 `WorkflowEvent` 显式分成三类：
  - 骨架事件
  - 中间过程输出
  - 最终结果
- `role_output` 现在优先按 `metadata.outputKind` 分流：
  - `progress` 进入灰色受限的中间输出面板
  - `summary/result/artifact` 进入结果区完整展示
  - 其他事件进入骨架事件区或错误结果区
- 新增暗红主题的 Ink UI Shell，包含顶部状态区、结果与事件区、骨架事件区、过程输出区和底部输入区。
- `IntakeAgent` 新增 `onWorkflowEvent` 回调，UI 可以直接消费原始事件，不再依赖最终字符串才能更新界面。
- 输入交互改由 Ink 承接，保留了普通输入、运行中补充输入和 `Ctrl+C` 中断逻辑；任务逻辑仍在 `IntakeAgent` 中。
- 手动启动验证过 `node --env-file=.env dist/cli/index.js`，界面可以正常渲染与退出。

## 改动理由

- PRD 明确要求 Intake 展示层使用 `Ink + React`，且不能继续以纯文本逐行打印作为目标方案。
- 当前 `formatWorkflowEventForCli()` 只适合字符串打印，不适合作为结构化 UI 分区的直接协议，因此需要单独的 view model 层来表达内容分流。
- `IntakeAgent` 已经具备完整业务控制能力，本次应只替换展示和输入承接层，避免把 Workflow 状态机逻辑搬进 React 组件。
- `ink@6` 在当前 CommonJS 工程下需要运行时动态导入，因此 CLI 入口需要处理 `Ink` 的异步加载，而不是继续直接 `require("ink")`。

## 未解决的不确定项

- 当前 UI 采用最小可交付布局，尚未实现更复杂的滚动、选择态高亮或更细的内容压缩策略。
- 结果区当前按块完整展示，若长期会话内容极多，后续可能还需要补充分页或虚拟化策略。

## 自检结果

- 已做：`pnpm test -- --runInBand`
- 已做：`pnpm build`
- 已做：手动运行 `node --env-file=.env dist/cli/index.js`，确认 Ink UI 能正常启动和 `Ctrl+C` 退出。
- 未做：完整长流程人工交互验收，例如真实 `codex exec` 大量中间输出下的视觉稳定性验证。

# clarifications/0.1.0 索引

## 命名规范

- 文件名使用 `[功能模块]-prd.md`
- `[功能模块]` 使用 kebab-case

## 当前文档

| 模块 | 文档 | 说明 |
|------|------|------|
| `default-workflow-intake-layer` | [default-workflow-intake-layer-prd.md](default-workflow-intake-layer-prd.md) | `default-workflow` 的 `Intake` 层需求文档 |
| `default-workflow-intake-error-explainability` | [default-workflow-intake-error-explainability-prd.md](default-workflow-intake-error-explainability-prd.md) | `default-workflow` 的 Intake 失败原因展示、错误解释与错误定位需求文档 |
| `default-workflow-intake-ink-ui` | [default-workflow-intake-ink-ui-prd.md](default-workflow-intake-ink-ui-prd.md) | `default-workflow` 的 `Intake` 终端展示层、Ink/React UI 与 codex 风格输出分层需求文档 |
| `default-workflow-intake-project-workflows` | [default-workflow-intake-project-workflows-prd.md](default-workflow-intake-project-workflows-prd.md) | `default-workflow` 的 Intake 从项目侧 `aegisproject.yaml` 读取多个 workflow、校验配置并基于 description 推荐 workflow 的需求文档 |
| `default-workflow-task-debug-transcript` | [default-workflow-task-debug-transcript-prd.md](default-workflow-task-debug-transcript-prd.md) | `default-workflow` 的任务级调试转录件需求文档，要求在每个 task 目录下同时输出可读 Markdown 调试件和保真 JSONL 调试事件流，并保留用户输入、AI 输出与底层 Executor 失败信息 |
| `default-workflow-workflow-layer` | [default-workflow-workflow-layer-prd.md](default-workflow-workflow-layer-prd.md) | `default-workflow` 的 `Workflow` 层需求文档 |
| `default-workflow-role-layer` | [default-workflow-role-layer-prd.md](default-workflow-role-layer-prd.md) | `default-workflow` 的 `Role` 层公共需求文档 |
| `default-workflow-cli-streaming-output` | [default-workflow-cli-streaming-output-prd.md](default-workflow-cli-streaming-output-prd.md) | `default-workflow` 的 CLI 流式输出与排版需求文档 |
| `default-workflow-role-codex-agent` | [default-workflow-role-codex-agent-prd.md](default-workflow-role-codex-agent-prd.md) | `default-workflow` 的角色 Codex Agent 运行需求文档 |
| `default-workflow-role-codex-cli` | [default-workflow-role-codex-cli-prd.md](default-workflow-role-codex-cli-prd.md) | `default-workflow` 的角色 Codex CLI 执行需求文档 |
| `default-workflow-role-codex-cli-output-passthrough` | [default-workflow-role-codex-cli-output-passthrough-prd.md](default-workflow-role-codex-cli-output-passthrough-prd.md) | `default-workflow` 的 Codex CLI 角色输出原样透传需求文档 |
| `default-workflow-role-node-pty-subcommand` | [default-workflow-role-node-pty-subcommand-prd.md](default-workflow-role-node-pty-subcommand-prd.md) | `default-workflow` 的 role 子命令行与 active role 架构需求文档 |
| `default-workflow-role-child-process-subcommand` | [default-workflow-role-child-process-subcommand-prd.md](default-workflow-role-child-process-subcommand-prd.md) | `default-workflow` 的 role 默认切换到 `child_process`、引入 CLI provider 抽象并补充 clarify 多轮问答工件机制的需求文档 |
| `default-workflow-role-prompt-bootstrap` | [default-workflow-role-prompt-bootstrap-prd.md](default-workflow-role-prompt-bootstrap-prd.md) | `default-workflow` 的角色原型与项目侧提示词装载需求文档 |
| `default-workflow-final-artifact-markdown-output` | [default-workflow-final-artifact-markdown-output-prd.md](default-workflow-final-artifact-markdown-output-prd.md) | `default-workflow` 的 phase 最终工件必须输出为可读 Markdown、并与 `RoleResult` 结构化包络解耦的需求文档 |

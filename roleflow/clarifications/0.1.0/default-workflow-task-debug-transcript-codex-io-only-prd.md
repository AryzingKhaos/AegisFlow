# Default Workflow Task Debug Transcript Codex IO Only PRD

## 文档信息

| 字段 | 内容 |
|------|------|
| 模块名 | `default-workflow-task-debug-transcript-codex-io-only` |
| 本文范围 | `default-workflow` 中 `runtime/debug-transcript.md` 的内容收缩，只保留用户输入、给 codex 的具体输入、codex 最终输出 |
| 文档路径 | `roleflow/clarifications/0.1.0/default-workflow-task-debug-transcript-codex-io-only-prd.md` |
| 直接使用者 | AegisFlow 开发者、Planner、Builder |
| 信息来源 | 用户新增需求、`roleflow/clarifications/0.1.0/default-workflow-task-debug-transcript-prd.md`、`src/default-workflow/persistence/task-store.ts`、当前 `debug-transcript.md` 实现 |

## Background

原始 `default-workflow-task-debug-transcript-prd.md` 已经落地，实现了双文件调试机制：

- `runtime/debug-events.jsonl`
- `runtime/debug-transcript.md`

但当前 `debug-transcript.md` 的职责被做得过重。结合现有实现可见，它目前包含：

- 任务概览
- 结果摘要
- 关键错误
- 全量时间线
- 原始输出附录

而时间线和附录中又混入了大量当前不再需要的内容，例如：

- `workflow_event`
- `role_visible_output`
- `intake_message`
- `executor_stdout`
- `executor_stderr`
- `executor_exit`
- 传输过程元信息

用户已经明确收窄需求：对于 `.aegisflow/artifacts/tasks/task_xxxx_xxx-feature_change_task/runtime/debug-transcript.md`，只需要记录：

1. 用户输入
2. 给 codex 的输入，且必须是具体值
3. codex 的输出

同时明确不要记录：

- codex 的过程输出
- 传输过程

这意味着 `debug-transcript.md` 不再承担“综合排障总览”的职责，而应收敛为一份极简的 I/O 转录件。真正的保真调试材料继续留在 `debug-events.jsonl`，而不是继续塞进 Markdown。

## Goal

本 PRD 的目标是把 `debug-transcript.md` 收敛为一份只面向“输入/输出复盘”的 Markdown 转录件，使系统能够：

1. 仅记录用户输入、codex 具体输入、codex 最终输出。
2. 去掉过程输出、工作流事件、传输细节和原始执行器日志。
3. 让开发者打开 `debug-transcript.md` 后，看到的是一次次明确的 I/O 往返，而不是大段调试噪音。
4. 保留 `debug-events.jsonl` 作为保真调试文件，不把“精简 transcript”误做成“丢掉底层调试能力”。

## In Scope

- `runtime/debug-transcript.md` 的内容范围
- transcript 中允许出现的记录类型
- “给 codex 的输入”与“codex 输出”的定义
- transcript 的最小结构与排序方式
- transcript 与 `debug-events.jsonl` 的职责边界

## Out of Scope

- 删除或弱化 `debug-events.jsonl`
- 改动任务状态持久化
- 改动 `workflow-events.jsonl`
- 改动 Intake UI 展示
- 增加新的远程日志系统

## 已确认事实

- 当前 `src/default-workflow/persistence/task-store.ts` 中的 `renderTaskDebugTranscript(...)` 会输出概览、摘要、关键错误、时间线和原始输出附录。
- 当前 transcript 的时间线会混入多种 `TaskDebugEvent` 类型，而不是只保留 I/O 主线。
- 当前 `TaskDebugEvent` 已包含：
  - `user_input`
  - `role_visible_output`
  - `executor_stdout`
  - `executor_stderr`
  - `executor_exit`
  - `executor_result_payload`
  - `workflow_event`
  - `intake_message`
- 当前真正发送给 codex 的内容在角色执行链路中是明确存在的，即传给执行器的 `prompt`。
- 用户此次提出的收缩对象是 `debug-transcript.md`，不是 `debug-events.jsonl`。

## 与既有 PRD 的关系

- 本文不替代 `default-workflow-task-debug-transcript-prd.md`。
- 本文是其补充澄清，用来重新定义 `debug-transcript.md` 的展示边界。
- 若旧 PRD 中存在“Markdown transcript 应包含摘要、错误、原始输出附录、全量时间线”等要求，则针对 `debug-transcript.md` 的部分应以本文为准。
- `debug-events.jsonl` 继续遵循旧 PRD 的保真要求，不因本文收缩。

## 术语

### User Input

- 指用户在 Intake 或任务运行期间输入给系统的原始文本。
- 必须保留原文，不做摘要改写。

### Codex Input

- 指系统实际发送给 codex 执行器的输入正文。
- 在当前架构中，应对应角色执行时传入 executor 的最终 `prompt` 字符串，而不是摘要、标签或来源列表。
- 必须保留具体值，而不是“提示词来源说明”。

### Codex Output

- 指 codex 在一次角色执行完成后返回的最终输出正文。
- 在当前架构中，应优先对应最终结果 payload / 最终返回文本，而不是中间流式输出。
- 必须保留原文，不做摘要压缩。

### Process Output

- 指 codex 在执行过程中流式吐出的中间输出、可见进度输出、增量消息或过程日志。
- 本文明确要求 `debug-transcript.md` 不得包含此类内容。

### Transport Process

- 指执行器 transport / provider 层的命令、参数、cwd、stdout/stderr、exit code、signal、timeout 等过程信息。
- 本文明确要求 `debug-transcript.md` 不得包含此类内容。

## Functional Requirements

### FR-1 transcript 只允许保留三类记录

- `debug-transcript.md` 只允许出现以下三类记录：
  - 用户输入
  - codex 输入
  - codex 输出
- 除此之外，不应再出现第四类正文记录。

### FR-2 用户输入必须保留原文

- 每次用户输入都必须按原始文本记录。
- 不得只保留最后一次输入。
- 不得把多次输入合并成摘要。
- 空输入若有业务意义，仍应显式记录。

### FR-3 必须记录发送给 codex 的具体输入值

- transcript 必须记录每次真正发送给 codex 的具体 prompt 文本。
- 不得只写“已调用 clarifier / builder / planner”之类的摘要。
- 不得只记录 prompt 来源文件列表。
- 若一次任务包含多次 codex 调用，每次调用都必须分别记录其输入原文。

### FR-4 必须记录 codex 最终输出原文

- transcript 必须记录每次 codex 调用产生的最终输出原文。
- 不得只写 summary。
- 不得只写解析后的部分字段而丢掉正文。
- 若最终输出为空，应显式标记为空，而不是补入过程日志替代。

### FR-5 transcript 不得包含 codex 过程输出

- 不得记录 `role_visible_output`。
- 不得记录流式 delta、过程进度、可见中间消息。
- 不得把“AI 正在执行”“builder 正在输出中间进度”这类内容写入 transcript。

### FR-6 transcript 不得包含传输过程

- 不得记录 `executor_stdout`、`executor_stderr`、`executor_exit`。
- 不得记录命令、参数、cwd、timeout、signal、exit code。
- 不得记录 transport/provider 的过程性附录。

### FR-7 transcript 不得包含 workflow 与 intake 噪音

- 不得记录 `workflow_event`。
- 不得记录 `intake_message`。
- 不得记录任务概览、运行时文件列表、关键错误摘要、全量时间线等总览性区块。
- transcript 不应再承担“任务审计报告”职责。

### FR-8 transcript 必须按实际时序展示 I/O 往返

- 三类记录必须按实际发生顺序排列。
- 同一轮调用中，顺序至少应满足：
  - 用户输入
  - codex 输入
  - codex 输出
- 若一次用户输入触发多次 codex 调用，则每次调用都应独立记录，并保持原始时序。

### FR-9 transcript 必须保留可读但极简的 Markdown 结构

- 允许保留文件标题。
- 允许使用清晰的小节标题或固定标签区分三类记录。
- 但不应再保留：
  - 任务概览
  - 结果摘要
  - 关键错误
  - 原始输出附录
  - 运行时文件清单

### FR-10 debug-events.jsonl 继续承担保真调试职责

- transcript 变简，不等于底层调试能力消失。
- 所有过程输出、传输信息、失败上下文，仍可继续保留在 `debug-events.jsonl`。
- Builder 不得为了满足本文而去删减 `debug-events.jsonl` 的保真内容。

## 推荐输出结构

以下结构仅为建议，但语义必须等价：

```md
# Task Debug Transcript

## 1. User Input

```text
<原始用户输入>
```

## 2. Codex Input

```text
<实际发送给 codex 的 prompt 原文>
```

## 3. Codex Output

```text
<codex 最终输出原文>
```
```

若有多轮，则按时序重复这三类区块，或使用等价的“轮次”结构，但不得引入额外过程性记录。

## 非功能要求

### NFR-1 极简可读

- 打开文件后应尽快看到原始 I/O，而不是先穿过摘要和调试附录。
- transcript 的首屏应尽量直接进入第一条有效 I/O 记录。

### NFR-2 高保真

- 用户输入、codex 输入、codex 输出都应保留具体值。
- 不得因“易读”而替换成摘要文案。

### NFR-3 明确分责

- `debug-transcript.md` 是极简 I/O 转录件。
- `debug-events.jsonl` 是保真调试事件流。
- 两者职责必须清晰分离，避免再次把 transcript 做成 debug report。

## 验收标准

- `debug-transcript.md` 中只出现三类正文内容：用户输入、codex 输入、codex 输出。
- 文件中不再出现 `workflow_event`、`role_visible_output`、`executor_stdout`、`executor_stderr`、`executor_exit` 的可读映射内容。
- 文件中不再出现“任务概览”“结果摘要”“关键错误”“原始输出附录”等大区块。
- 对于一次真实 codex 调用，开发者可以在 transcript 中看到发送过去的完整 prompt 原文，以及返回的最终输出原文。
- `debug-events.jsonl` 仍然保留原有保真能力，不因 transcript 收缩而丢失底层信息。

## Open Questions

- 无。

## Assumptions

- 用户此次要求收缩的是 `debug-transcript.md`，而不是删除底层 `debug-events.jsonl`。
- “给 codex 的输入（具体值）”应解释为实际发送给 codex executor 的最终 prompt 原文。
- “codex 的输出”应解释为最终输出原文，而非中间流式过程输出。

## Todolist (todoList)

- [x] 确认用户要求只保留用户输入、codex 输入、codex 输出。
- [x] 确认当前 transcript 中存在大量额外内容，确实与新要求不一致。
- [x] 明确收缩对象为 `debug-transcript.md`，而不是 `debug-events.jsonl`。
- [x] 规定 transcript 禁止再包含过程输出、传输过程和 workflow/intake 噪音。
- [x] 定义新的极简 transcript 结构与验收边界。


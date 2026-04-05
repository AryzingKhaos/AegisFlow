# Default Workflow Task Debug Transcript PRD

## 文档信息

| 字段 | 内容 |
|------|------|
| 模块名 | `default-workflow-task-debug-transcript` |
| 本文范围 | `default-workflow` 中每个任务目录下的调试记录、可读转录件与原始调试事件保留 |
| 文档路径 | `roleflow/clarifications/0.1.0/default-workflow-task-debug-transcript-prd.md` |
| 直接使用者 | AegisFlow 开发者、Planner、Builder |
| 信息来源 | 用户需求、用户澄清结论、当前仓库实现代码 |

## Background

当前问题不是“系统完全没有日志”，而是“调试可见性不足，现有落盘内容不适合定位问题”。

结合代码阅读，可以确认当前已有能力如下：

- `tasks/<taskId>/runtime/workflow-events.jsonl` 已存在，用于保存 `WorkflowEvent`
- `tasks/<taskId>/runtime/task-state.json` 与 `task-state.md` 已存在，用于保存任务快照
- `tasks/<taskId>/runtime/task-context.json` 已存在，但其中的 `latestInput` 只保留最近一次输入，不保留完整输入历史

当前真正的缺口包括：

1. 用户输入没有完整时间线，只有最后一次 `latestInput`
2. `workflow-events.jsonl` 偏底层，直接排查成本高，不适合人工阅读
3. `role_output` 虽然会进入 `WorkflowEvent`，但 Executor/CLI 的底层 `stdout`、`stderr`、退出码、超时等信息没有形成任务级调试档案
4. 失败信息虽然会进入错误链路，但缺少一份按任务时间线整理的“完整调试转录件”
5. 当前没有一份明确的需求，来约束“哪些信息必须保留，哪些信息必须便于人读”

因此，本 PRD 的目标不是再加一份普通 log，而是定义一套任务级 Debug Transcript 机制：

- 一份给人读的 `Markdown` 调试转录件
- 一份保真、可检索、可复盘的结构化调试事件流

## 代码澄清结论

本轮基于实际代码的澄清结论如下。

### 结论 1：当前已经有原始 Workflow 事件日志，但它不是用户真正需要的调试材料

- `src/default-workflow/persistence/task-store.ts` 当前会把 `WorkflowEvent` 落盘到 `runtime/workflow-events.jsonl`
- 这说明“完全没有日志”并不成立
- 真正缺的是“方便人工快速定位问题的任务调试件”

### 结论 2：用户输入历史当前会丢失

- `src/default-workflow/workflow/controller.ts` 中的 `saveLatestInput(...)` 只会覆盖保存 `latestInput`
- `src/default-workflow/shared/types.ts` 中的 `PersistedTaskContext` 也只有 `latestInput`
- 因此当前无法从任务目录恢复完整的输入时间线

### 结论 3：当前可见的 AI 输出和底层执行输出不是同一个层级

- `role_output` 会作为 `WorkflowEvent` 被记录
- `src/default-workflow/role/executor.ts` 中的底层 `stdout` 只会挑出“可见消息”继续往上透传
- `stderr`、退出码、超时、signal 等底层执行信息，目前没有形成任务目录下的完整调试记录

### 结论 4：当前失败信息会被摘要化，缺少原始上下文保留

- `src/default-workflow/role/executor.ts` 在子进程失败时，会把 `stderr` 或退出码包装成 `Error`
- `src/default-workflow/workflow/controller.ts` 的 `failWithError(...)` 最终会把错误收敛到 `WorkflowEvent(error).metadata.error`
- 这对用户展示足够，但对深度排查仍不够，因为原始失败上下文没有单独沉淀成可追踪记录

### 结论 5：需要“双视图”而不是“单一日志”

- 用户已经明确接受“双文件方案”
- 同时要求记录：
  - 用户输入全文
  - AI 运行时返回的所有内容
  - 所有失败信息
  - Executor/CLI 原始输出
- 因此只做单个普通日志文件不满足需求

## Goal

本 PRD 的目标是为 `default-workflow` 定义统一的任务级调试记录机制，使每个任务目录都能同时提供：

1. 一份适合人工阅读的调试转录件
2. 一份保真结构化事件流
3. 对失败、超时、非零退出、stderr、原始模型输出等关键信息的完整保留
4. 对用户输入、控制指令、恢复操作、运行期中间输出的完整时间线追踪

## 已确认决策

- 采用双文件方案，而不是单文件方案
- 两份文件都必须放在对应 task 目录下
- 必须保留所有失败信息，不能只保留成功路径
- “AI 运行时返回的所有内容”包括：
  - 用户输入全文
  - `role_output` 中间流式输出
  - `role_output` 最终结果
  - `WorkflowEvent` 全量事件
  - Executor / CLI 原始 `stdout`
  - Executor / CLI 原始 `stderr`
  - 退出码、signal、超时等执行结果信息

## In Scope

- 每个 task 目录下的调试文件设计
- 调试记录的落盘位置与命名规范
- 可读 `Markdown` 转录件的结构要求
- 结构化调试事件流的保真要求
- 用户输入、控制指令、AI 输出、Workflow 事件、底层执行信息的记录范围
- 失败与异常信息的保留要求
- 调试记录相关的验收标准

## Out of Scope

- 具体实现代码修改
- 远程日志系统
- 聚合多任务的全局日志平台
- 敏感信息脱敏系统
- Web 可视化调试后台

## 落盘位置要求

### FR-1 每个任务必须生成独立的调试记录

- 调试文件必须放在对应任务目录下，不能落到全局共享目录
- 推荐沿用现有 `runtime/` 目录，以保持和 `task-state.*`、`task-context.json`、`workflow-events.jsonl` 的一致性
- 本期建议目标路径如下：
  - `tasks/<taskId>/runtime/debug-transcript.md`
  - `tasks/<taskId>/runtime/debug-events.jsonl`

### FR-2 不得用新的调试文件替代既有 runtime 文件

- `task-state.json`
- `task-state.md`
- `task-context.json`
- `workflow-events.jsonl`

以上文件仍应保留；新的调试文件是补充调试视图，不是替换现有持久化结构。

## 双文件设计要求

### FR-3 必须同时提供 Markdown 转录件与结构化事件流

- `debug-transcript.md`：
  - 面向人工阅读
  - 目标是快速定位“发生了什么、卡在哪、为什么失败”
- `debug-events.jsonl`：
  - 面向程序检索和高保真复盘
  - 目标是保留完整时间线与原始上下文

### FR-4 Markdown 转录件不能只是一份原始日志拼接

- `debug-transcript.md` 不能退化成把所有事件直接按行堆起来
- 它必须有清晰结构，至少包含：
  - 任务概览
  - 当前/最终状态
  - 失败摘要或完成摘要
  - 时间线主体
  - 关键错误区
  - 原始输出附录或引用

### FR-5 结构化事件流不能只保留摘要信息

- `debug-events.jsonl` 必须保真
- 不能只保存“人读摘要”
- 必须保留事件原文、原始错误信息、底层执行上下文和关键元信息

## 记录范围要求

### FR-6 必须记录完整的用户输入时间线

- 每次用户输入都必须记录，而不是只保留最后一次
- 至少包括：
  - 初始自然语言需求
  - 澄清阶段回答
  - 运行中补充输入
  - 恢复任务时输入
  - 取消、恢复、中断等控制指令

### FR-7 必须记录 AI 的全部用户可见输出

- 至少包括：
  - `role_output` 的中间输出
  - `role_output` 的最终结果
  - Intake 层显示给用户的错误说明
  - Workflow 层对用户可见的阶段/角色/进度信息

### FR-8 必须记录底层 Executor/CLI 原始输出

- 至少包括：
  - 原始 `stdout`
  - 原始 `stderr`
  - 退出码
  - signal
  - timeout 信息
  - 启动失败或进程级异常

### FR-9 必须完整保留失败与异常信息

- 不仅要保留最终失败结论，还要保留失败前后的上下文
- 至少应覆盖：
  - 配置错误
  - Workflow 运行错误
  - Role 执行错误
  - CLI 非零退出
  - 超时
  - 输出解析失败
  - 路径不可访问
  - 恢复任务失败

### FR-10 必须同时保留“摘要错误”和“原始错误”

- 调试文档需要可读摘要
- 结构化事件流需要原始错误材料
- 不能为了美观只保留“用户友好文案”，导致原始错误丢失

## Markdown 转录件设计要求

### FR-11 Markdown 转录件必须突出可读性和排障效率

- 第一屏应优先回答以下问题：
  - 这个任务是什么
  - 当前/最终状态是什么
  - 失败还是成功
  - 如果失败，最直接的失败原因是什么
  - 失败发生在哪个 phase / role / executor

### FR-12 Markdown 转录件必须包含固定摘要区

摘要区至少应包含：

- `taskId`
- 标题或任务描述摘要
- workflow 标识
- projectDir
- artifactDir
- 开始时间
- 最后更新时间
- 当前/最终状态
- 当前/最终 phase
- 当前/最终 active role
- 若失败则包含失败摘要

### FR-13 Markdown 转录件必须按时间线展示关键过程

时间线至少应覆盖：

- 用户输入
- Intake 判定
- workflow 启动
- phase 切换
- role 开始/结束
- 中间输出
- 工件创建
- 错误事件
- 任务结束

### FR-14 Markdown 转录件必须区分信息层级

至少区分以下层级：

- 用户输入
- 系统事件
- AI 可见输出
- 底层执行原始输出
- 错误与失败

不得把不同层级信息完全混排成一段正文。

### FR-15 Markdown 转录件必须对噪声做结构化整理，而不是删除信息

- 用户担心普通 log 信息过多，不容易排查
- 因此 `Markdown` 的优化方向应是“结构化整理”，不是“减少记录内容”
- 即：
  - 失败相关内容应上提
  - 中间输出可分区展示
  - 原始输出可进入附录或专门区块
- 但原始信息必须仍可在任务目录内找到

### FR-16 Markdown 转录件应优先为失败场景优化

- 失败任务中，应把以下内容显式前置：
  - 失败摘要
  - 原始错误
  - phase / role / executor 位置
  - 最后一个用户输入
  - 最后一个关键事件
  - 最近的 `stderr` 或非零退出信息

## 结构化事件流要求

### FR-17 结构化调试事件流必须覆盖完整调试来源

`debug-events.jsonl` 中至少应允许表达以下事件类别：

- `user_input`
- `intake_message`
- `workflow_event`
- `role_visible_output`
- `executor_stdout`
- `executor_stderr`
- `executor_exit`
- `error`
- `snapshot_reference`

本期不强制先定义最终 TypeScript 类型名，但需求层必须明确这些语义维度不可缺失。

### FR-18 结构化调试事件必须可关联到执行上下文

每条结构化调试事件至少应尽量关联：

- `taskId`
- 时间戳
- phase
- role
- 来源层级
- 原始文本或结构化 payload

### FR-19 结构化调试事件必须支持失败复盘

- 对于失败任务，单靠 `WorkflowEvent(error)` 不足以支撑完整复盘
- 结构化调试事件必须能够追溯：
  - 失败前最后一个用户输入
  - 失败前最后一个 role 输出
  - 失败前最近的 executor 原始输出
  - 实际退出结果

## 与现有文件的关系

### FR-20 debug-events.jsonl 与 workflow-events.jsonl 的职责必须区分

- `workflow-events.jsonl`：
  - 保留当前 Workflow 视角的正式事件流
- `debug-events.jsonl`：
  - 面向调试与排障
  - 覆盖更宽的来源范围
  - 包含用户输入与底层 Executor 输出

因此，`debug-events.jsonl` 不是简单重命名 `workflow-events.jsonl`。

### FR-21 debug-transcript.md 必须可引用现有 runtime 文件

- 为避免重复过多内容，`debug-transcript.md` 可引用或链接现有文件
- 至少可引用：
  - `task-state.json`
  - `task-state.md`
  - `task-context.json`
  - `workflow-events.jsonl`
  - 相关 artifact 文件

但即便引用存在，调试转录件本身仍必须足够让人快速理解问题，不得只剩路径列表。

## 验收要求

### FR-22 成功任务也必须具备可追踪调试记录

- 本能力不能只在失败时落盘
- 成功任务也必须生成调试记录
- 但失败任务应展示更多失败诊断摘要

### FR-23 失败任务必须能在 1 份 Markdown 中看清核心问题

对于任意一个失败任务，开发者打开 `debug-transcript.md` 后，应能快速看出：

- 用户当时输入了什么
- 系统选择了哪个 workflow
- 执行推进到了哪个 phase / role
- AI 输出了什么
- 底层执行器返回了什么
- 为什么失败
- 失败时任务状态是什么

### FR-24 原始失败信息不得丢失

- 若底层有 `stderr`
- 若存在非零退出码
- 若存在 signal
- 若存在 timeout

则这些信息必须至少在 `debug-events.jsonl` 中存在，且应尽量在 `debug-transcript.md` 中可见或被摘要引用。

### FR-25 输入历史不得再退化成只保留 latestInput

- 一旦本能力落地，任务目录下必须能恢复完整输入序列
- 不能继续只有 `latestInput`

## Constraints

- 仅覆盖 `v0.1`
- 只描述需求，不展开具体实现方案
- 必须兼容当前 task 目录结构
- 必须优先服务本地任务调试，不引入远程依赖

## Risks

- 如果只加普通文本 log，信息量会继续失控，用户仍难以定位问题
- 如果只做可读 `md` 而不保留结构化原始事件，后续程序检索和精确复盘会受限
- 如果只保留最终错误摘要，不保留 `stderr`、退出码、超时等底层信息，复杂失败仍无法定位
- 如果输入历史继续只保留 `latestInput`，多轮澄清和恢复问题将难以复盘

## Open Questions

- `debug-transcript.md` 是否需要在后续版本中增加“最近失败片段”置顶摘要区，用于进一步缩短排障路径
- 后续版本是否需要补充敏感信息脱敏策略

## Assumptions

- `runtime/` 仍将作为任务级运行态文件的主要目录
- `workflow-events.jsonl` 将继续保留，不会被新的调试文件替代
- 后续实现会以“不丢原始信息”为第一原则，而不是只追求展示美观

# default-workflow intake layer review 修复说明

## 修改文件列表

- `src/default-workflow/shared/constants.ts`
- `src/default-workflow/runtime/builder.ts`
- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/testing/intent.test.ts`
- `src/default-workflow/testing/agent.test.ts`

## 改动摘要

- 修复自定义工件目录下的恢复任务发现逻辑，新增基于 CLI 当前工作目录的最近任务索引文件，用于在 CLI 重启后准确定位上一次中断任务。
- 修复资料追问阶段控制指令被误当成普通输入的问题，当前在 `pendingStep` 阶段会优先识别 `cancel_task`、`resume_task` 和超范围请求。
- 修复 `WorkflowEvent` CLI 展示不完整的问题，当前会输出 `type`、`taskId`、`timestamp`、`message` 与可选 `metadata`，并继续附带 `TaskState` 摘要。
- 扩大超范围和越权请求识别规则，覆盖“跳过 Clarify 直接 Build”“phase 编排”等明显超出 Intake 职责的表达。
- 新增自动化测试覆盖上述修复点。

## 改动理由

- review 文档指出的两个高风险问题都真实存在，且直接影响 PRD 承诺的恢复能力和入口控制能力，必须优先修复。
- 恢复链路此前只回落到默认工件目录扫描，无法覆盖用户自定义工件目录场景，因此需要增加显式索引。
- 资料追问阶段如果不先识别控制意图，就会把取消或恢复请求错误写入收集字段，破坏 Intake 的交互可控性。
- 事件展示补全 `taskId` 与 `timestamp` 后，CLI 验收和排障信息才完整。

## 未解决的不确定项

- 当前最近任务索引按 CLI 启动目录隔离，适合当前单入口使用方式；如果后续支持跨多个入口目录共享恢复索引，还需要再定义更明确的索引策略。
- 越权识别仍然是规则驱动，不代表已经覆盖所有自然语言表达，只是补上了当前 review 指出的主要缺口。

## 自检结果

- 已做：
- 执行 `pnpm test`，8 个测试全部通过。
- 执行 `pnpm build`，编译通过。
- 新增自动化用例覆盖：自定义工件目录恢复、追问阶段取消、事件展示完整性、phase 越权输入识别。

- 未做：
- 未补充真正的 CLI 端到端黑盒测试框架，当前仍以 agent 层自动化测试为主。

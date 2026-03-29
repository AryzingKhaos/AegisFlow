# default-workflow intake layer 编排输入与范围守卫修复说明

## 修改文件列表

- `src/default-workflow/shared/types.ts`
- `src/default-workflow/shared/constants.ts`
- `src/default-workflow/shared/utils.ts`
- `src/default-workflow/intake/intent.ts`
- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/runtime/builder.ts`
- `src/default-workflow/testing/intent.test.ts`
- `src/default-workflow/testing/agent.test.ts`
- `src/default-workflow/testing/runtime.test.ts`

## 改动摘要

- 为 `ProjectConfig` 新增显式的 `orchestration` 配置对象，包含 `profileId`、`label`、`phases`、`resumePolicy`、`approvalMode`。
- Intake 新增 `confirm_workflow_orchestration` 追问步骤，在收集项目目录和工件目录之前，先让用户确认当前使用的 `default-workflow/v0.1` 流程编排。
- `Runtime` 初始化与恢复校验现在都会检查 `workflow orchestration` 是否存在且 phases 非空，不再只依赖简化版 `WorkflowSelection`。
- CLI 启动任务成功后，会明确展示当前使用的流程编排及 phase 列表。
- 将超范围识别从单纯命中 `OUT_OF_SCOPE_PATTERNS`，提升为独立的边界守卫函数 `isOutOfScopeRequest()`，结合“角色引用 / phase 引用 / 指令性表达”做组合判断。
- 新增测试覆盖：编排确认追问、角色接管类超范围输入、普通任务描述不被误杀。

## 改动理由

- 之前实现确实只收集了任务类型、项目目录、工件目录，没有把“workflow 具体流程编排”作为 Runtime 初始化输入显式落地，这和计划文档要求不完全一致。
- 现在即使本期只支持一套 `default-workflow/v0.1` 编排，也必须把这套编排以明确输入和配置对象的方式进入 `Runtime`，否则仍然只是“选了 workflow 类型”。
- 超范围请求此前主要依赖少量关键词，不能稳定覆盖“切角色”“切 phase”“直接编排 workflow”这类越权表达；提升为边界守卫后，至少可以从“单点关键词”变成“语义结构上的组合规则”。

## 未解决的不确定项

- 当前虽然已经把 `workflow orchestration` 作为显式输入落地，但本期仍只支持一套 `default-workflow/v0.1` 编排，暂不支持用户自定义 phase 列表或多套编排配置切换。
- 范围守卫仍然是规则驱动，不是基于真实模型推理，因此不能保证覆盖所有自然语言表达，但比原先的单组关键词匹配更贴近“边界判定”。

## 自检结果

- 已做：
- 执行 `pnpm build`，通过。
- 执行 `pnpm test`，11 个测试全部通过。
- 执行 `printf '修复登录报错\ny\ny\n默认\n默认\n取消任务\n' | pnpm cli`，确认 CLI 实际会追问并显示 `workflow orchestration`。

- 未做：
- 未实现多套可选 orchestration profile，因为当前版本需求仍限定在 `default-workflow/v0.1`。

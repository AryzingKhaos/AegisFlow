# default-workflow-intake-codex-exec-failure-main-screen 实现说明

## 修改文件列表

- `src/default-workflow/intake/error-view.ts`
- `src/default-workflow/intake/error-view.test.ts`
- `src/cli/output-layout.ts`
- `src/cli/output-layout.test.ts`
- `src/cli/app.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-codex-exec-failure-main-screen.md`

## 改动摘要

- 为 Intake 主屏新增 `failure_main_screen` 布局模式：当任务已失败且可识别为 `codex exec` 中断类失败时，结构化失败信息页会进入主输出区域首位。
- 主输出流中的历史内容没有被删除，但会自动降级到失败页之后，并以“历史输出”标题弱化处理；顶部附加 `ErrorPanel` 在该模式下不再重复渲染。
- 在 `error-view.ts` 中新增显式中断识别规则 `isCodexExecInterruption(...)`，覆盖 `Role agent execution failed`、timeout、transport/provider、network、token/quota、认证等高频执行器失败语义。
- 同步增强中断类下一步建议：timeout、额度/token、transport/provider/网络问题分别给出更具体的建议，而不是继续落回通用“请重试”。
- 新增自动化测试覆盖 failure main screen 触发、非误触发，以及 timeout / transport / quota 场景建议映射。

## 改动理由

- 现有链路虽然已经能采集失败原因，但主屏阅读中心仍由时间流和 `任务执行失败。` 这类通用骨架消息占据，不符合新 PRD 对“失败页必须成为主内容”的要求。
- 仅保留顶部错误块不够，因为主区域仍会继续展示通用失败状态和历史输出，用户第一眼未必能看到真正的执行器中断原因。
- `codex exec` 中断类失败和普通 workflow/工件失败不是同一类问题，需要显式识别，避免把所有失败都无差别地主屏化。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test -- src/cli/output-layout.test.ts src/cli/ui-model.test.ts src/default-workflow/intake/error-view.test.ts`
- 已做：`pnpm build`
- 已做：人工核对 failure main screen 只在 `taskStatus === "failed"` 且命中 `codex exec` 中断识别时触发，普通 `artifactReady=false` 等 workflow 失败不会误触发。
- 未做：真实终端下的手动视觉验收，以及真实外部 `codex` 执行中断联调。

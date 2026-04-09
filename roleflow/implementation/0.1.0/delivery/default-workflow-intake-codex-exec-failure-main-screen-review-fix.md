# default-workflow-intake-codex-exec-failure-main-screen review fix 实现说明

## 修改文件列表

- `src/default-workflow/intake/error-view.ts`
- `src/default-workflow/intake/error-view.test.ts`
- `src/cli/output-layout.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-codex-exec-failure-main-screen.md`

## 改动摘要

- 收紧 `isCodexExecInterruption(...)` 识别条件：现在必须先命中明确的执行器链路标记，如 `Role agent execution failed:`、`executor transport error`、`executor timed out`、`codex exited with code`，不再仅凭 `provider`、`token`、`authentication`、`timeout` 等宽泛关键词触发。
- 同步把中断类下一步建议的增强逻辑收口到执行器链路上下文中，避免普通配置错误或业务错误仅因包含相似关键词就走错建议分支。
- 新增负例测试，覆盖 `provider`、`token/authentication`、普通 `timeout` 文案等非执行器上下文场景，防止误把非 `codex exec` 失败提升成主屏失败页。

## 改动理由

- review 指出的范围外扩问题是成立的。此前实现把“执行器链路标记”和“常见错误词”放在同一层 OR 条件里，会让一部分非执行器失败被错误主屏化。
- 计划文档明确要求这是“`codex exec interruption` + 执行链路上下文”的判定，因此识别规则必须先锁定执行器来源，再决定是否进入 failure main screen。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test -- src/default-workflow/intake/error-view.test.ts src/cli/output-layout.test.ts`
- 已做：`pnpm build`
- 已做：补充 provider/token/auth/timeout 宽泛关键词的负例测试，确认不会误触发主屏失败页。
- 未做：真实外部 `codex` 中断场景的终端联调。

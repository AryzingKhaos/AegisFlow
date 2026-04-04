# 实现说明

## 修改文件列表

- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/testing/agent.test.ts`

## 改动摘要

- 调整 `IntakeAgent.handleUserInput(...)`，允许在 `confirm_workflow` 追问阶段接收空输入，不再被提前拦截为“请输入需求或任务控制指令”。
- 调整 `confirm_workflow` 分支处理，用户直接回车时默认执行确认逻辑，等同于输入 `y`。
- 更新 workflow 确认提示文案和非法输入提示文案，明确说明“直接回车等同于 y”。
- 新增自动化测试，覆盖推荐 workflow 后直接回车会进入已确认分支并继续追问工件目录。

## 改动理由

- 当前启动流程要求用户在 workflow 推荐后额外显式输入 `y`，与“回车即接受默认推荐”的期望不一致。
- 直接把空输入映射为确认，可以减少一次无意义输入，同时保留显式输入 `n` 切换 workflow 的能力。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：阅读并定位 `IntakeAgent` 启动追问链路，确认空输入是被 `handleUserInput(...)` 的前置校验拦截。
- 已做：补充 `src/default-workflow/testing/agent.test.ts`，覆盖 workflow 确认阶段“回车默认接受”的行为。
- 已做：计划执行 `vitest` 的 intake 相关测试验证本次改动。
- 未做：未进行人工交互式 CLI 终端验收。

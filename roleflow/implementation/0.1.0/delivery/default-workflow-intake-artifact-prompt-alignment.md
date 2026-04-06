# default-workflow-intake-artifact-prompt-alignment 实现说明

## 修改文件列表

- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/testing/agent.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-layer.md`

## 改动摘要

- 收敛 Intake 启动提示文案，明确说明工件目录是“先确认设置”，其中绝对路径会立即创建，默认目录或相对路径要等确认 `projectDir` 后再创建。
- 收敛首次工件目录追问提示，避免继续暗示“无论什么路径都会先创建目录再继续后续收集”。
- 新增回归测试，锁定 bootstrap 文案和首轮追问文案与实际状态机一致。

## 改动理由

- 当前状态机本身没有问题，问题在于提示把“绝对路径分支”的行为误说成了“所有分支”的统一行为。
- 这类偏差虽然不直接导致执行错误，但会误导用户准备材料的时机，尤其是在默认目录或相对路径场景下。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test -- src/default-workflow/testing/agent.test.ts`
- 已做：`pnpm build`
- 未做：真实 CLI 端到端手动演练。

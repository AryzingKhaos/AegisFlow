# default-workflow-followup-fixes 实现说明

## 修改文件列表

- `src/default-workflow/workflow/controller.ts`
- `src/default-workflow/runtime/builder.ts`
- `src/default-workflow/shared/utils.ts`
- `src/default-workflow/intake/agent.ts`
- `src/default-workflow/testing/runtime.test.ts`
- `src/default-workflow/testing/agent.test.ts`

## 改动摘要

- 收紧 phase 工件可见性：`explore` 现在只读取 `clarify/final-prd`，后续普通 phase 只读取上一阶段主工件，不再把所有历史工件一股脑暴露给当前角色。
- Intake 交互文案里的确认提示从 `yes/no` 统一改成 `y/n`，同时保留现有解析能力。
- 新任务的 `taskId` 序号改为扫描 `.aegisflow/artifacts/tasks/` 下已有目录，取最大序号 `+1`，不再使用随机数。
- 补充测试覆盖：`explore` 只看到最终 PRD、任务 ID 按目录最大序号递增、Intake 编排确认文案改为 `y/n`。

## 改动理由

- 当前执行注释已经明确“后续 phase 默认消费前一阶段工件”，但实现里实际暴露了全部历史工件，这会让 `explore` 在 `clarify` 之后拿到过多输入，容易重复展开。
- `yes/no` 提示不符合当前 CLI 期望，直接改成 `y/n` 更简洁。
- 任务目录名属于可见工件约定，序号必须稳定递增，否则恢复、查找和人工排查都会变差。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test -- --runInBand`
- 已做：`pnpm build`
- 已做：人工核对 `explore` 之后的普通 phase 工件输入收敛到上一阶段主工件。
- 未做：真实外部 `codex` CLI 长流程联调。

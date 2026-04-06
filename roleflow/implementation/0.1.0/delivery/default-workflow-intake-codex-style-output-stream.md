# default-workflow-intake-codex-style-output-stream 实现说明

## 修改文件列表

- `src/cli/app.ts`
- `src/cli/output-layout.ts`
- `src/cli/theme.ts`
- `src/cli/output-layout.test.ts`
- `src/cli/theme.test.ts`
- `src/cli/ui-model.test.ts`

## 改动摘要

- 将 Intake 输出布局从旧的 `result / skeleton / intermediate` 三分区，收敛为“主输出流 + 运行态过程区”两层结构。
- 主输出流现在会把 `finalBlocks` 和 `skeletonBlocks` 合并后按 `UiBlock.order` 统一排序，不再先按类型分区再展示。
- 过程输出改为显式的 `summary + detail` 结构：仅在 `taskStatus === "running"` 时显示，摘要固定可见，detail 只保留最近 6 行，并在超出时展示 `...`。
- 去掉输出区、结果块和过程区对边框卡片的依赖，改为普通文本流和留白层次；系统消息正文同步切到卡其色暖调。
- 更新 CLI 相关测试，覆盖主流合流、运行态过程区、6 行截断、省略语义、共享排序字段和系统消息颜色映射。

## 改动理由

- 新 PRD 已明确覆盖旧的三区域 panel 方向，继续保留结果区 / 骨架区 / 过程区的独立边框结构会直接违背本轮需求。
- `UiBlock.order` 已经提供了稳定的统一时序字段，没有必要改 Workflow 协议，只需要在 Intake 布局层完成合流。
- 过程输出如果不限制为运行态、且不限制 detail 行数，就会继续抢占主阅读区，和 codex 风格的轻量时间流目标相反。
- 系统消息正文此前仍落在偏灰的次级正文色上，和骨架辅助色过近，需要显式切到卡其色才能拉开语义。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test -- src/cli/output-layout.test.ts src/cli/theme.test.ts src/cli/ui-model.test.ts`
- 已做：`pnpm build`
- 已做：人工核对输出区仅在 `app.ts` 的 OutputPanel 主链路去边框，未越权改动状态栏、输入框和错误说明外壳。
- 未做：真实终端下的人工视觉验收与截图比对。

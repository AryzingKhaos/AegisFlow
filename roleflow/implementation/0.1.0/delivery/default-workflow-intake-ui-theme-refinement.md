# 实现说明

## 修改文件列表

- `src/cli/theme.ts`
- `src/cli/theme.test.ts`
- `src/cli/app.ts`
- `src/cli/ui-model.ts`
- `src/cli/ui-model.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-ui-theme-refinement.md`

## 改动摘要

- 新增 `src/cli/theme.ts`，把原来单层 `THEME` 拆成 `chrome / text / result / skeleton / intermediate / input / status / error` 分层 token。
- 调整 Intake Ink UI 结构：结果区改成 `PrimaryResultArea`，放在主阅读起点；骨架区改成更轻的 `SkeletonArea`；过程输出区继续低权重保留。
- 结果块改成更强的卡片式表达，区分 `RESULT / SYSTEM / ERROR` 三类眉标题和对应边框、标题、正文颜色。
- 骨架区不再复用结果区的 panel 语义，改成更适合快速扫读的轻量事件列表，并对多行消息做压缩展示。
- `UiBlock.tone` 从旧的 `muted` 收敛成 `system`，让系统消息和普通结果在结果区里有更清晰的独立语义。
- 新增主题测试，补充 ui-model 测试，保护结果区、骨架区、错误态和系统消息的层级语义。

## 改动理由

- 现有 UI 的主要问题不是“有没有颜色”，而是结果区和骨架区在 panel 结构和强调方式上过于接近，导致主次不清。
- 这次改动的重点是把终端结构从“多个同权区块纵向堆叠”收敛成“主结果优先、骨架降权、过程输出最低权重”的三级层次。
- 参考 `codex cli` 的方向主要体现在布局和信息权重上，而不是做终端像素级复刻；因此保留了 AegisFlow 的暗红主题，同时显式细化 token 层级。

## 未解决的不确定项

- 当前自动化测试仍主要覆盖纯函数和视图模型层，没有直接做 Ink 组件快照测试；终端中的最终视觉效果仍建议手工验收。
- 本次没有引入多主题能力，也没有为不同终端背景单独做自适应。

## 自检结果

- 已做：运行 `pnpm test -- src/cli/theme.test.ts src/cli/ui-model.test.ts`，Vitest 实际跑了当前全套 9 个测试文件，`89` 个测试全部通过。
- 已做：运行 `pnpm build`，`tsc` 编译通过。
- 已做：确认改动仅落在 Intake UI 展示层和其视图模型映射，没有改动 Workflow 状态机、Role 协议或 phase 工件格式。
- 手动验收清单：
  - 有结果块：确认主结果区位于主阅读位置，`RESULT / SYSTEM / ERROR` 三类块可一眼区分。
  - 仅骨架事件：确认骨架区仍可见，但低于主结果区，不再像第二个主面板。
  - 长过程输出：确认过程输出区仍是最低层级，长内容不会在视觉上压过结果区。
  - 错误结果：确认错误块使用独立错误色，而不是复用普通结果色。
  - 空状态：确认结果区、骨架区和过程输出区在空状态时仍有明确但低权重的提示。

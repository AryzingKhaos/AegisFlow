# 实现说明

## 修改文件列表

- `src/cli/app.ts`
- `src/cli/output-layout.ts`
- `src/cli/output-layout.test.ts`
- `src/cli/ui-model.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-intake-output-structure-separation.md`

## 改动摘要

- 将 Intake 输出层从单一混排面板改回“外层输出壳层 + 结果区 / 骨架区 / 过程输出区”三区域结构，结果区固定在最前，骨架区其次，过程输出区最后。
- 删除 `buildOutputEntries(...)` 这类跨区域扁平收口路径，不再把 `finalBlocks`、`skeletonBlocks`、`intermediateLines` 合并成一个统一列表渲染。
- 新增 `src/cli/output-layout.ts`，把区域排序、按内容显隐、过程输出换行展开与截断收敛成纯函数，作为结构级防回退入口。
- 结果区新增独立 `ResultRegion / ResultBlock` 构建逻辑；骨架区新增独立 `SkeletonRegion / SkeletonBlock`；过程输出区新增独立 `IntermediateRegion`，三者分别消费 `theme.ts` 中对应 token。
- 重写 `src/cli/ui-model.test.ts` 中原本鼓励跨流混排的断言，并新增 `src/cli/output-layout.test.ts`，覆盖固定区域顺序、稀疏显示和过程输出截断三类回归风险。

## 改动理由

- 本次 PRD 的核心不是继续调色，而是禁止“结果、骨架、过程输出”重新退化成单一输出列表；因此需要直接修复渲染结构，而不是只补 token。
- `CliViewModel` 已经天然按三路数据分流，问题出在 `app.ts` 最后一层把它们重新扁平化；把布局逻辑抽到纯函数后，review 和测试都能直接锁定结构职责。
- 旧测试里存在“跨流顺序保护”，会把错误语义继续固化；这次同步改写测试，才能真正完成防回退。

## 未解决的不确定项

- 无。
- 补充说明：当前自动化保护以纯函数和视图模型测试为主，没有新增 Ink 组件快照测试；终端最终观感仍建议结合实际 CLI 手工看一遍。

## 自检结果

- 已做：运行 `pnpm test -- src/cli/output-layout.test.ts src/cli/ui-model.test.ts src/cli/theme.test.ts`，Vitest 实际共执行 10 个测试文件、105 个测试，全部通过。
- 已做：运行 `pnpm build`，`tsc` 编译通过。
- 已做：确认改动仅落在 Intake CLI 输出组织层与相关测试，没有改动 Workflow 状态机、`CliViewModel` 事件来源协议或非 Intake 页面。

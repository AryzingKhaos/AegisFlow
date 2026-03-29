# default-workflow-workflow-layer 审计问题修复说明

## 修改文件列表

- `src/default-workflow/workflow/controller.ts`
- `src/default-workflow/testing/runtime.test.ts`

## 改动摘要

- 修复审批恢复时把“批准继续”“继续执行”这类控制语句误传给下一阶段角色的问题。
- 修复最后一个 `needApproval: true` phase 会直接跳过审批、直接完成任务的问题。
- 修复失败和取消路径未收敛 `phaseStatus`，导致出现 `status=failed` 且 `phaseStatus=running` 冲突状态的问题。
- 补充回归测试，覆盖审批恢复输入污染、尾 phase 审批、失败态和取消态 `phaseStatus` 一致性。

## 改动理由

- 审计报告里的三条问题都是真问题，而且都落在状态机边界上，不修会直接污染恢复链路和审批语义。
- 审批恢复输入污染不仅会影响 `runRole(input)`，还会污染 `latestInput`，后续真实角色接入后风险会更大，因此一起修复。
- 尾 phase 审批是 PRD 里明确要求的通用能力，不能依赖“后面还有 phase”才生效。
- `PhaseStatus` 只有 `pending / running / done` 三个合法值，终止态下继续保留 `running` 会让快照和恢复语义失真。

## 未解决的不确定项

- `latestInput` 目前仍然表示“最近一次业务输入”，但后续真实角色接入后，是否还需要拆分成“用户自由文本”和“角色显式执行输入”两个字段，仍需后续版本明确。
- 最终审批通过后目前直接收敛为 `completed`，没有单独补发 `artifact_created` 类型的“审批记录工件”；PRD 当前没有要求，但后续如果要做审计留痕，可能还需要单独补。

## 自检结果

- 已做：`pnpm build`
- 已做：`pnpm test`
- 已做：针对三条审计问题分别补充自动化回归测试
- 未做：CLI 端到端人工烟测

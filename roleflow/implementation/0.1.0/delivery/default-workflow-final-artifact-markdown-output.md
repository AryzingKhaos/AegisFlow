# 实现说明

## 修改文件列表

- `src/default-workflow/workflow/final-artifact.ts`
- `src/default-workflow/workflow/controller.ts`
- `src/default-workflow/role/model.ts`
- `src/default-workflow/testing/final-artifact.test.ts`
- `src/default-workflow/testing/runtime.test.ts`
- `src/default-workflow/testing/role.test.ts`
- `roleflow/implementation/0.1.0/default-workflow-final-artifact-markdown-output.md`

## 改动摘要

- 新增 `workflow/final-artifact.ts`，显式定义各 phase 的最终工件规则：`clarify` 固定为 `final-prd`，其余 phase 默认以 `artifactIndex=0` 的主工件作为最终工件。
- 在 `WorkflowController` 中把最终工件保存入口统一接入 Markdown normalizer；`clarify/final-prd` 和通用 phase 主工件都会在落盘前先做 JSON 解包、JSON fenced block 转 Markdown、补充 `summary` / `metadata` 可读章节。
- 保持 `FileArtifactManager.saveArtifact(...)` 原样写盘职责不变，协议解释和人读化收敛全部留在 `Workflow` 层完成。
- 调整 `resolveVisibleArtifactKeys(...)`，让下游 phase 显式消费上一阶段的最终主工件，而不是继续依赖隐含排序。
- 收敛 `role/model.ts` 里的角色执行协议文案，明确 `artifacts` 应优先返回人类可读 Markdown 正文，禁止把完整 `RoleResult` JSON 包络再塞进 `artifacts`。
- 新增纯函数测试覆盖 normalizer 的关键输入形态，并补充 runtime/role 集成测试，锁住 `clarify/final-prd` 与 `plan` 最终计划工件两类已知问题样本。

## 改动理由

- 当前 `.md` 最终工件存在“正文其实是 `RoleResult` JSON 包络”的问题，人打开工件时先看到机器协议而不是实际内容，这与 phase 工件的人类可读性目标冲突。
- 问题根因在 `Workflow` 最终工件保存边界，而不是持久化层；因此需要在 `Workflow` 明确区分“运行时结构化协议”和“最终给人看的 Markdown 正文”。
- 只修 `clarify` 不够，因为 `plan` 等其他 phase 也走通用 `roleResult.artifacts` 保存链路；所以本次把最终工件选择规则和 normalizer 都做成统一入口。

## 未解决的不确定项

- 非最终的中间工件本次仍保持现状，没有统一纳入“不得是 JSON dump”的强制规则。
- `metadata` 的可读保留字段目前采用代码内白名单策略，后续如果角色侧形成稳定 schema，可以再继续收敛成独立约束。

## 自检结果

- 已做：运行 `pnpm test -- src/default-workflow/testing/final-artifact.test.ts src/default-workflow/testing/runtime.test.ts src/default-workflow/testing/role.test.ts`，Vitest 实际执行了当前全套 7 个测试文件，`75` 个测试全部通过。
- 已做：运行 `pnpm build`，`tsc` 编译通过。
- 已做：确认 `task-state.json`、`task-context.json` 等机器状态文件链路未改动，`FileArtifactManager.saveArtifact(...)` 仍是原样写入。
- 未做：没有回写历史工件，也没有对非最终中间工件增加额外规范化逻辑。

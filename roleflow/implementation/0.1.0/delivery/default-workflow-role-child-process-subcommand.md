# default-workflow-role-child-process-subcommand 实现说明

## 修改文件列表

- `src/default-workflow/shared/types.ts`
- `src/default-workflow/shared/utils.ts`
- `src/default-workflow/runtime/builder.ts`
- `src/default-workflow/runtime/dependencies.ts`
- `src/default-workflow/role/executor.ts`
- `src/default-workflow/role/retained/node-pty.ts`
- `src/default-workflow/role/model.ts`
- `src/default-workflow/workflow/controller.ts`
- `src/default-workflow/testing/role.test.ts`
- `src/default-workflow/testing/runtime.test.ts`
- `src/default-workflow/testing/agent.test.ts`
- `.aegisflow/aegisproject.yaml`
- `.aegisflow/roles/planner.md`
- `roleflow/implementation/0.1.0/default-workflow-role-child-process-subcommand.md`

## 改动摘要

- 将 `RoleExecutorConfig` 从单层 `codex-cli` 结构收敛为 `transport + provider` 两层，默认值与 YAML 解析统一切到 `child_process + codex`。
- 新增 one-shot 默认执行器：`src/default-workflow/role/executor.ts` 现在通过 `child_process` 启动一次性 CLI 子进程，并由 `codex` provider 负责命令拼装、输出文件回读和增量可见输出解析。
- 将旧 `node-pty` 实现迁入 `src/default-workflow/role/retained/node-pty.ts`，保留历史能力，但当前主链路不再引用。
- `RoleResult` 增加 `artifactReady`、`phaseCompleted`，Workflow 对普通 phase 显式消费这两个宿主判断语义。
- `WorkflowController` 新增 `runClarifyPhase()`，为 `clarify` 阶段落地 `initial-requirement`、`clarify-dialogue`、`final-prd` 三类工件，并按 `metadata.decision` 在“继续提问”和“生成最终 PRD”之间路由。
- 运行中 `participate` 语义改为 one-shot deferred，不再透传给 active role。
- 更新配置示例、角色提示词镜像和测试，确保 transport/provider、新的 clarify 闭环以及 one-shot 语义都有覆盖。

## 改动理由

- PRD 明确要求默认执行路径从 `node-pty` 长会话切到 `child_process` one-shot，且 transport 层不能继续写死 `codex` 协议。
- `clarify` 是本次改造的唯一流程特例，必须从“普通 phase 单次执行”中拆出来，才能稳定支持多轮问答工件和最终 PRD 二次生成。
- `artifactReady` / `phaseCompleted` 需要真正进入 Workflow 消费链路，否则 `hostRole` 的最小判断语义只停留在文档层。
- `.aegisflow/roles` 与 `roleflow/context/roles` 的镜像内容存在漂移，当前测试与项目约束都要求它们保持一致，因此一并同步。

## 未解决的不确定项

- 无。

## 自检结果

- 已做：`pnpm test -- --runInBand`
- 已做：`pnpm build`
- 已做：人工核对默认主链路不再引用 retained `node-pty` 实现，普通 phase 不再依赖 `sendInput/sessionId/resume`。
- 已做：人工核对 `clarify` 工件路径与命名为 `initial-requirement`、`clarify-dialogue`、`final-prd`。
- 未做：真实外部 `codex` CLI 联调；当前仅通过 stub 与测试注入 transport 覆盖协议与流程行为。

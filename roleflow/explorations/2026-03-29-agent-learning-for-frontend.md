# 探索报告 [L0]：前端低频内容与 Agent 学习入口
探索日期: 2026-03-29 | 关键词: agent, workflow, role, runtime

## Entry Points
| 触发动作                              | 文件路径                                             |
| --------------------------------- | ------------------------------------------------ |
| CLI 启动并接收用户输入                     | `src/cli/index.ts:4`                             |
| 库入口导出 default-workflow 与 template | `src/index.ts:1`                                 |
| Intake 接收需求、恢复任务、转发 Runtime 事件    | `src/default-workflow/intake/agent.ts:62`        |
| Workflow 推进 phase 与 role 执行       | `src/default-workflow/workflow/controller.ts:28` |

## Module Responsibility
| 文件路径                                                                    | 职责                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/default-workflow/intake/agent.ts:62`                               | 前端相对低频；负责 CLI 对话、任务草稿、恢复/取消/中断，不是页面交互代码。                         |
| `src/default-workflow/intake/intent.ts:57`                              | 前端相对低频；把自然语言输入归一化为 workflow 意图。                                  |
| `src/default-workflow/runtime/builder.ts:44`                            | 前端相对低频；装配 Runtime、Workflow、RoleRegistry、ArtifactManager，并处理恢复重建。 |
| `src/default-workflow/workflow/controller.ts:28`                        | 学 agent 最值得先看；这里是 phase 状态机与 role 调度中枢。                          |
| `src/default-workflow/runtime/dependencies.ts:39`                       | 前端相对低频；负责 RoleRegistry、RoleDefinition、能力边界与事件日志注入。               |
| `src/default-workflow/role/model.ts:26`                                 | 学 agent 核心；负责模型初始化、执行 prompt 拼装、角色结果解析。                          |
| `src/default-workflow/role/prompts.ts:26`                               | 学 agent 核心；把角色原型文档、项目角色文档组装成最终 prompt。                           |
| `src/default-workflow/persistence/task-store.ts:49`                     | 前端相对低频；把 task state、artifact、context 落盘，支撑可恢复执行。                 |
| `src/default-workflow/shared/types.ts:208`                              | 定义 Runtime、Workflow、Role、Artifact 等核心协议，是各层共享接口。                 |
| `src/default-workflow/shared/constants.ts:129`                          | 定义 phase、role、默认模型与越界规则，属于编排配置层。                                 |
| `src/template/models/exploration.ts:11`                                 | 前端相对低频；描述 exploration/plan 模板模型，不参与 Runtime 执行。                  |
| `src/template/examples/explorations/unfamiliarProjectArchitecture.ts:3` | 前端相对低频；提供文档模板示例，主要服务工件规范。                                        |
| `src/default-workflow/testing/runtime.test.ts:47`                       | 学 agent 推荐阅读；验证 phase 顺序、审批暂停、恢复重建。                              |
| `roleflow/context/roles/explorer.md:1`                                  | 前端相对低频；定义项目内 Explorer 的输出边界。                                     |
| `roleflow/context/roles/common.md:1`                                    | 前端相对低频；定义项目内所有角色的公共补充约束。                                         |
| `roleflow/clarifications/0.1.0/default-workflow-role-layer-prd.md:1`    | 前端相对低频；属于工作流设计文档，不是运行时代码。                                        |
| `roleflow/implementation/0.1.0/default-workflow-role-layer.md:1`        | 前端相对低频；记录 role-layer 实施方案。                                       |
| `roleflow/reviews/0.1.0/default-workflow-role-layer.md:1`               | 前端相对低频；记录实现后的 review 工件。                                         |

## Dependency Graph
`src/cli/index.ts:4` → `src/default-workflow/intake/agent.ts:62` → `src/default-workflow/runtime/builder.ts:44` → `src/default-workflow/workflow/controller.ts:28` → `src/default-workflow/runtime/dependencies.ts:39` → `src/default-workflow/role/model.ts:26`

`src/default-workflow/intake/agent.ts:62` → `src/default-workflow/intake/intent.ts:86` → `src/default-workflow/shared/constants.ts:129`

`src/default-workflow/workflow/controller.ts:28` → `src/default-workflow/shared/types.ts:208` → `src/default-workflow/persistence/task-store.ts:49`

`src/default-workflow/role/model.ts:53` → `src/default-workflow/role/prompts.ts:26` → `roleflow/context/roles/explorer.md:1`

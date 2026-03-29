# default-workflow-role-layer 审计报告

## 审计元信息

- 审计角色：Frontend Critic
- 审计范围：`default-workflow` 的 `Role` 层公共机制、`RoleRegistry / RoleDefinition / RoleRuntime / ExecutionContext / RoleResult`、prompt 组装与 `Workflow -> Role` 调用边界
- 审计对象：当前 `git` 修改区代码
- 对照文档：
  - `roleflow/implementation/0.1.0/default-workflow-role-layer.md`
- 验证方式：
  - 执行 `pnpm build`，通过
  - 执行 `pnpm test`，通过
  - 结合当前源码与最小复现检查默认 prompt 解析路径
- 额外核对：
  - 本次未引入新第三方依赖
  - 暂存代码新增注释为中文，符合项目约束

---

# 已修复问题复验

- 上次报告中的“默认角色没有真正以 Agent 方式运行”已修复。当前默认角色执行已进入 `executeRoleAgent()`，在 `agent` 模式下会真实调用 `llm.invoke(...)`，不再只是初始化 bootstrap 后返回本地模板字符串。
- 上次报告中的“`critic` 默认不读取项目侧提示词文件”已修复。当前仓库已存在 `[critic.md](/Users/aaron/code/Aegisflow/.aegisflow/roles/critic.md)`，默认 `buildRolePrompt("critic", createProjectConfig(...))` 会成功读取该文件，最小复现下 `promptWarnings` 已为空。

---

# 关键问题（高风险）

- 当前未发现新的高风险问题。

---

# 次要问题（中风险）

## [配置漂移] `aegisproject.yaml` 位置错误，且 `frontend-critic` 重命名后的配置、索引和 PRD 没有同步
- **位置**：`[aegisproject.yaml](/Users/aaron/code/Aegisflow/aegisproject.yaml#L1)`、`[aegisproject.yaml](/Users/aaron/code/Aegisflow/aegisproject.yaml#L42)`、`[.aegisflow/roles/index.md](/Users/aaron/code/Aegisflow/.aegisflow/roles/index.md#L30)`、`[roleflow/context/roles/index.md](/Users/aaron/code/Aegisflow/roleflow/context/roles/index.md#L30)`、`[default-workflow-role-prompt-bootstrap-prd.md](/Users/aaron/code/Aegisflow/roleflow/clarifications/0.1.0/default-workflow-role-prompt-bootstrap-prd.md#L153)`
- **描述**：按照当前补充约束，`aegisproject.yaml` 的正确位置应是 `.aegisflow/` 下，而不是仓库根目录。当前修改区新增的是根目录 `[aegisproject.yaml](/Users/aaron/code/Aegisflow/aegisproject.yaml)`，文件位置已经不符合约束；同时它内部仍保留 `roles.overrides.critic.extraInstructions: ".aegisflow/roles/frontend-critic.md"`，两个角色索引文档也仍把实例文件登记为 `frontend-critic.md`。除此之外，新增的 `[default-workflow-role-prompt-bootstrap-prd.md](/Users/aaron/code/Aegisflow/roleflow/clarifications/0.1.0/default-workflow-role-prompt-bootstrap-prd.md#L153)` 还在继续要求“仓库根目录必须创建 `aegisproject.yaml`”。也就是说，这次重命名只改了角色文件本身，没有把配置入口、索引清单和需求文档一起收敛。
- **触发条件**：阅读项目配置、索引文档、PRD，或后续真正接入项目配置文件加载时。
- **影响范围**：当前运行时虽然因为默认路径命中 `critic.md` 没有立刻出错，但配置文件放错位置会让后续配置加载链路直接找不到该文件；即使后续移动到正确目录，里面的 override 仍会继续指向不存在的旧路径。同时索引文档和 PRD 会持续误导维护者按旧路径和旧位置实现。
- **风险级别**：中
- **严重程度**：配置失真

## [项目约束加载] 项目侧 `common.md` 没有进入角色 prompt 组装，公共实例层约束会被整体跳过
- **位置**：`[prompts.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/prompts.ts#L42)`、`[prompts.ts](/Users/aaron/code/Aegisflow/src/default-workflow/role/prompts.ts#L64)`、`[common.md](/Users/aaron/code/Aegisflow/.aegisflow/roles/common.md#L1)`、`[frontend-critic.md](/Users/aaron/code/Aegisflow/.aegisflow/roles/frontend-critic.md#L3)`
- **描述**：当前 prompt 组装只读取“角色原型公共文档 + 角色原型文档 + 项目侧同名角色文件/override 文件”，不会读取项目侧的 `[common.md](/Users/aaron/code/Aegisflow/.aegisflow/roles/common.md)`。而项目侧角色文件本身只是用一行引用去声明公共规范，并没有把公共约束正文重复写入角色文件中。这意味着所有角色默认都会遗漏项目公共实例层约束，例如“所有文档输出均使用中文”“开始任务前阅读 `project.md`”等内容。
- **触发条件**：任意默认角色通过 `buildRolePrompt()` 组装 prompt。
- **影响范围**：角色 prompt 实际读取到的项目侧约束不完整，所有角色都可能丢失 AegisFlow 的公共项目约束，不仅限于 `critic`。
- **风险级别**：中
- **严重程度**：体验不佳

---

# 改进建议（低风险）

## [测试覆盖] 现有测试没有覆盖重命名后的默认 `critic.md` 路径，也没有覆盖配置文件位置与项目侧 `common.md`
- **位置**：`[role.test.ts](/Users/aaron/code/Aegisflow/src/default-workflow/testing/role.test.ts#L117)`
- **描述**：当前测试验证的仍是“给 `critic` 显式传入 `rolePromptOverrides` 后可以读取 override 文件”，没有覆盖现在已经改成默认同名解析的 `critic.md` 路径，也没有断言项目侧 `common.md` 是否进入 `promptSources`，更没有覆盖项目配置文件的放置位置与文件名一致性。因此本轮重命名后的配置漂移和公共约束漏装都不会被测试拦住。
- **影响范围**：默认配置下的 prompt 组装回归仍然容易被遗漏。
- **风险级别**：低
- **类型**：可维护性

---

# 不确定风险

- 当前项目文档把 `.aegisflow/roles/` 定义为“实际对外暴露的角色提示词目录”，但这套目录与 `roleflow/context/roles/` 的同步方式没有在代码里体现。如果两处文件未来继续发生命名漂移，Role 层读取到的实例约束是否仍可信，需要后续再明确。

---

# 潜在技术债务

- prompt 组装链路已经同时涉及“角色原型”“项目侧同名文件”“override 文件”，但还没有统一建模“实例层公共文件”这一层。后续继续扩展角色时，类似漏读公共约束的问题仍会重复出现。
- 角色文件名重命名后，配置文件位置、配置内容和角色索引都需要手工同步；当前仓库没有任何机制保证这些清单和真实目录结构一致，后续类似命名漂移仍会反复出现。

---

# 架构设计评估

- 本次实现在契约层已经比上次完整很多：默认角色执行、`RoleCapabilityProfile`、`ArtifactReader` 和 `RoleResult.artifacts: string[]` 都已进入可工作的公共机制。
- 当前剩余问题集中在“项目角色约束是否完整、配置位置与文档是否同步”这一层，而不是 Agent 执行层。也就是说“角色怎么跑”已经接近闭环，但“角色到底看到了哪些项目约束”还没有完全闭环。
- 如果不先收敛 prompt 来源优先级和默认映射，角色行为会继续表现出“能运行，但不完全符合本项目约束”的偏差。

---

# 修复优先级

- **P1**：`aegisproject.yaml` 放置位置错误，且 `frontend-critic` 重命名后的配置与索引漂移问题
- **P1**：项目侧 `common.md` 未进入角色 prompt 组装的问题
- **P3**：缺少默认 prompt 解析路径测试的问题

---

# 测试建议

- 增加默认 `critic.md` 路径测试，明确断言 `[critic.md](/Users/aaron/code/Aegisflow/.aegisflow/roles/critic.md)` 会进入 `promptSources`，并避免继续把旧的 `frontend-critic.md` 当作项目侧文件名。
- 增加角色 prompt 组装测试，断言项目侧 `[common.md](/Users/aaron/code/Aegisflow/.aegisflow/roles/common.md)` 也会被纳入最终 prompt。
- 增加配置与索引一致性检查，至少保证 `.aegisflow/aegisproject.yaml` 的存在位置正确，且其中角色文件名、角色索引与 `.aegisflow/roles/` 实际文件一致。

---

# 审计总结

- 审计范围：`default-workflow` Role 层公共机制、默认角色注册与执行、prompt 组装、`Workflow -> Role` 边界
- 问题统计：高风险 0 个，中风险 2 个，低风险 1 个
- 整体评价：上次指出的默认角色执行问题和 `critic` 默认路径问题都已修复，当前 Role 层主执行链路基本成立；但项目公共约束仍未进入 prompt，且本轮重命名后还遗留了“配置文件放错位置 + 配置/索引未同步”的问题

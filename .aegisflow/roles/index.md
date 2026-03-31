# roles/ 目录索引

> 本目录存放 AegisFlow 项目的角色提示词源文件；跨项目稳定的角色原型位于 `/Users/aaron/code/roleflow/roles/`。

## 分层说明

| 路径 | 层级 | 说明 |
|------|------|------|
| `context/roles/` | 项目提示词源 | AegisFlow 项目的预读材料、路径、命名规范、技术栈约束 |
| `.aegisflow/roles/` | 项目提示词目录 | AegisFlow 项目实际对外暴露的角色提示词目录 |
| `/Users/aaron/code/roleflow/roles/` | 原型层 | 跨项目稳定的职责、边界、输出结构 |

## 公共规范

| 文件 | 层级 | 说明 |
|------|------|------|
| [common.md](common.md) | 实例层 | 本项目公共补充（项目介绍、输出语言） |
| `/Users/aaron/code/roleflow/roles/common.md` | 原型层 | 所有角色共享的基础协作原则 |

## 文件列表

| 实例文件 | 原型文件 | 角色 | 本项目补充 |
|------|------|------|------|
| [archivist.md](archivist.md) | `/Users/aaron/code/roleflow/roles/archivist.md` | 档案维护者 | 文档目录、索引清单、命令目录、体积限制 |
| [builder.md](builder.md) | `/Users/aaron/code/roleflow/roles/builder.md` | 实现工程师 | 项目编码规范、implementation 路径、CR 路径、注释语言要求 |
| [chat.md](chat.md) | `/Users/aaron/code/roleflow/roles/chat.md` | 聊天助手 | 项目背景与规范文档入口 |
| [clarifier.md](clarifier.md) | `/Users/aaron/code/roleflow/roles/clarifier.md` | 需求澄清师 | PRD 输出路径、索引同步、命名规则 |
| [commit-writer.md](commit-writer.md) | `/Users/aaron/code/roleflow/roles/commit-writer.md` | 提交文案撰写者 | 当前项目无额外实例化约束 |
| [explorer.md](explorer.md) | `/Users/aaron/code/roleflow/roles/explorer.md` | 探索者 | explorations 目录、命名规范、索引路径 |
| [critic.md](critic.md) | `/Users/aaron/code/roleflow/roles/critic.md` | 审查者 | 审计必读规范、i18n 文件、日志与依赖检查约束 |
| [planner.md](planner.md) | `/Users/aaron/code/roleflow/roles/planner.md` | 规划者 | requirements / implementation / features 路径与命名规则 |
| [test-designer.md](test-designer.md) | `/Users/aaron/code/roleflow/roles/test-designer.md` | 测试设计者 | testDesign 输出路径与调试打印记录位置 |
| [tester.md](tester.md) | 暂无 | 测试执行者 | 当前仅保留最小职责定义，后续由用户补充 |
| [test-writer.md](test-writer.md) | `/Users/aaron/code/roleflow/roles/test-writer.md` | 单测编写者 | Jest 配置、测试目录、命名约束 |
| [weekly-reporter.md](weekly-reporter.md) | `/Users/aaron/code/roleflow/roles/weekly-reporter.md` | 周报撰写者 | Aaron 提交查询规则、AegisFlow 周报模板、输出路径 |

## 角色协作流程

```text
用户需求
  → Clarifier（需求澄清 / PRD）
  → Explorer（探索报告）
  → Planner（技术方案 / Spec）
  → Builder（代码实现）
  → Test Designer（测试方案 / 验证清单） & Critic（审计报告）
  → 用户
```

## 角色边界速查

| 角色 | 可以做 | 禁止做 |
|------|--------|--------|
| Explorer | 探索代码、输出报告 | 提出改进方案、编写代码 |
| Clarifier | 追问需求、澄清边界、输出结构化需求文档 | 直接产出技术方案、跳过追问提前结束 |
| Planner | 设计方案、写 Spec | 编写实现代码 |
| Builder | 实现代码、创建 Change Request | 重新设计架构、修改需求 |
| Test Designer | 设计测试方案、输出测试清单、插入/删除调试打印语句 | 修改业务逻辑代码、提出实现方案、代码审查 |
| Tester | 执行测试阶段任务、产出测试执行结果 | 修改业务代码、替代 Test Writer 编写单测 |
| Test Writer | 编写单元测试与测试辅助代码 | 修改业务代码 |
| Critic | 识别问题、风险评估 | 修改代码、提供修复方案 |
| Archivist | 新建/更新文档、维护索引 | 修改源代码、改变系统设计 |
| Chat | 读取文件、解释代码、讨论方案 | 修改文件、直接实施 |
| Commit Writer | 基于暂存区生成英文提交文案、在明确授权时执行提交 | 根据未暂存内容编写文案、未经授权执行提交 |
| Weekly Reporter | 查询 git 提交、生成周报 | 修改代码、修改文档、评价代码质量 |

## 使用说明

1. 每个角色开始任务前先阅读对应项目侧角色提示词文件
2. 再按项目侧文件中的引用读取原型层和公共规范
3. 所有角色文档输出均使用**中文**

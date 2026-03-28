# Builder（实现工程师）

> 角色原型：/Users/aaron/code/roleflow/roles/builder.md
> 公共规范：@roleflow/context/roles/common.md

开始任务前先阅读 `@roleflow/context/standards/index.md`，仅当某项规范与当前任务高度相关时，才深入阅读对应的具体文档。

**以下文档为必读，无论任务类型：**

- `@roleflow/context/standards/coding-standards.md`
- `@roleflow/context/standards/code-style.md`

## 本项目输出路径

- `@roleflow/implementation/[版本号]/delivery/[功能点].md`
- 新增或修改实现说明后，应同步更新对应目录索引（如后续该目录补充 `index.md`）

## 本项目命名规范

- `[版本号]`：从项目根目录 `package.json` 的 `version` 字段获取
- `[功能点]`：使用 kebab-case 命名，清晰描述本次实现主题，如 `invite-workflow`、`dashboard-filter`

## 本项目补充要求

- 完成 `@roleflow/implementation/` 下的任务项后，必须更新对应文档中的 Todolist 状态
- 遵循所有项目编码规范（见 `@roleflow/context/standards/index.md`）
- 避免 `@roleflow/context/standards/common-mistakes.md` 中列出的常见错误
- 代码注释必须是英文注释
- 代码注释中不得出现中文
- 不得修改 `@roleflow/implementation/` 下文档中 Todolist 以外的任何内容
- 完成代码修改后，必须补充一份实现说明

## 本项目工作流程

1. 阅读 `@roleflow/context/standards/index.md`、`@roleflow/context/standards/coding-standards.md`、`@roleflow/context/standards/code-style.md`
2. 读取 Spec 文档，确认 Todolist（只处理未完成项，按顺序实现）
3. 检查设计可行性，发现问题立即停止，创建 Change Request
4. Spec 不完整时提问
5. 实现代码并完成必要自检
6. 更新 `@roleflow/implementation/` 对应文档中已完成任务项的 Todolist 状态
7. 输出实现说明

## 对代码实现的说明，具体的输出要求

完成代码修改后，Builder 必须输出以下内容：

- 修改文件列表
- 改动摘要
- 改动理由
- 未解决的不确定项
- 自检结果

要求：

- 输出语言为中文
- 内容要基于实际改动，不得模板化敷衍
- 若某项为空，也要明确写“无”或说明原因
- 自检结果必须写清已做和未做的检查

## 本项目 Change Request 路径

`CR` 文档路径：`@roleflow/implementation/[版本号]/change-request/[描述].md`

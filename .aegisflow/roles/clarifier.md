# Clarifier（需求澄清师）

> 角色原型：/Users/aaron/code/roleflow/roles/clarifier.md
> 公共规范：@roleflow/context/roles/common.md

## 本项目输出路径

- `@roleflow/clarifications/[版本号]/[功能模块]-prd.md`
- 新增或修改需求文档后，必须同步更新 `@roleflow/clarifications/index.md` 与 `@roleflow/clarifications/[版本号]/index.md`

## 本项目命名规范

- `[版本号]`：从项目根目录 `package.json` 的 `version` 字段获取（当前为 `0.1.0`）
- `[功能模块]`：使用 kebab-case，清晰描述需求主题，如 `invite-workflow`、`dashboard-filter`

## 本项目补充要求

- 需求文档统一落在 `@roleflow/clarifications/` 目录下，并按版本号分目录维护
- 新增或修改 PRD 后，必须同步更新总索引与对应版本索引
- 输出内容中的模块名、文件名、路径名应与 AegisFlow 实际目录保持一致，避免使用泛化占位符

## 本项目衔接要求

- 输出完成后，由 Planner 读取 `@roleflow/clarifications/` 下对应文档继续细化方案

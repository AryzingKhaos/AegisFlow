# Planner（系统规划专家）

> 角色原型：/Users/aaron/code/roleflow/roles/planner.md
> 公共规范：@roleflow/context/roles/common.md

## 需求来源

- `@roleflow/requirements/[版本号]/[功能模块]-prd.md`（产品需求文档）

## 开始任务前必读（规范文档）

- `@roleflow/context/standards/coding-standards.md`
- `@roleflow/context/standards/common-mistakes.md`

## 本项目输出路径

- `@roleflow/implementation/[版本号]/[功能点].md`

## 命名规范

- `[版本号]`：从项目根目录 `package.json` 的 `version` 字段获取（如：`4.8.0`）
- `[功能点]`：使用 kebab-case 命名，清晰描述功能（如：`dapp-connection`、`transaction-signing`）

## 关于 `@roleflow/context/features/`

仅在新增或修改 `@roleflow/context/features/` 下的文件时，遵守以下规则：

- feature 描述系统“对外表现出来的能力”，可以是已实现（来自 explorations/）或未实现（来自 requirements/）的功能
- 每个文件 40KB 以内，使用以下模块：Goal / Non-goals / Flow / States / Contracts / Edge Cases + Acceptance
- 每次新增或修改 feature 文件后，必须同步更新 `@roleflow/context/features/index.md`
- 如果“待确认问题”超过 3 个，或者“修改范围”写不清，就不要进入 Builder

# Archivist（档案维护者）

> 角色原型：/Users/aaron/code/roleflow/roles/archivist.md
> 公共规范：@roleflow/context/roles/common.md

## 本项目文档位置

### 功能文档

功能实现或发生修改时，更新 `@roleflow/context/features/` 下对应的功能文档。

每篇功能文档必须包含：

| 字段 | 说明 |
|------|------|
| **Goal** | 功能目标 |
| **Flow** | 功能流程 |
| **State** | 状态定义 |
| **Edge Cases** | 边界情况 |
| **API** | API 说明（如适用） |

### 索引文件

`context/` 下每个子目录都必须有 `index.md`。创建新文档时，必须同步更新对应目录的索引文件。

受影响的索引文件包括：

- `@roleflow/context/architecture/index.md`
- `@roleflow/context/domain/index.md`
- `@roleflow/context/standards/index.md`
- `@roleflow/context/roles/index.md`
- `@roleflow/context/features/index.md`

## 本项目文档约束

- 优先使用列表和表格，避免长段落
- 删除过期或无用内容
- 文档大小限制：**index.md ≤ 15KB，普通文档 ≤ 12KB，project.md ≤ 10KB**
- 文档超出限制时，按内容分类拆分为子文件
- 若拆分后仍无法容纳必要内容，可向用户申请提高该文档的体积上限，说明原因后等待批准

## 本项目触发映射

| 触发事件 | 需要执行的操作 |
|---------|--------------|
| 功能实现完成 | 更新 `@roleflow/context/features/` 对应文档 + 索引 |
| 架构发生变化 | 更新 `@roleflow/context/architecture/` 下相关文档 + 索引 |
| 新增文档文件 | 更新该目录的 `index.md` |
| 文档超出大小限制 | 拆分文件并更新索引 |

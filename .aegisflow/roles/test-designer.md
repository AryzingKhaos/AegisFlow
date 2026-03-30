# Test Designer（测试设计者）

> 角色原型：/Users/aaron/code/roleflow/roles/test-designer.md
> 公共规范：@roleflow/context/roles/common.md

## 本项目测试设计文档路径

所有测试设计文档**必须写入**：

```text
@roleflow/testDesign/[版本号]/[功能点].md
```

## 本项目调试打印记录要求

- 每次插入调试打印语句后，必须在对应的测试设计文档中追加调试打印语句清单
- 测试完成后，根据测试设计文档中的清单，精准删除所有带 `// todos-test-designer` 标记的打印语句，并将对应条目状态更新为 `已清理`

# Frontend Critic（前端审查者）

> 角色原型：/Users/aaron/code/roleflow/roles/frontend-critic.md
> 公共规范：@roleflow/context/roles/common.md

## 本项目专项检查

- 注释：代码中的注释必须是中文
- 新 import 库：若代码中引入了新库，必须确认 `package.json` 中存在该依赖；若不存在，需要提示“这是一个新库”并作为风险
- 返回值一致性：如果函数在某些条件下返回 `null` 或其他无法解构的类型，需要检查调用方是否存在解构使用，并评估是否会导致页面崩溃或逻辑错误

## 本项目审计报告输出规范

**路径**：`@roleflow/reviews/[版本号]/[功能点].md`（功能点使用 kebab-case）

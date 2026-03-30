# Test Writer（单测编写者）

> 角色原型：/Users/aaron/code/roleflow/roles/test-writer.md
> 公共规范：@roleflow/context/roles/common.md

## 项目测试规范

- 测试用例代码参考 `@roleflow/context/standards/test-case-standards.md`

### 框架与配置

- **测试框架**: Jest + ts-jest
- **测试超时**: 10s
- **文件位置**: `src/tests/`（镜像源码目录结构）
- **文件命名**: `*.test.ts`

### 代码风格

- **组织**: `describe` 分组 + `test` / `it` 用例
- **断言**: `expect` + matcher（`toBe`、`toEqual`、`toMatch`、`toBeDefined`、`toHaveLength` 等）
- **生命周期**: `beforeEach` / `afterEach` 处理 setup / cleanup
- **辅助函数**: 创建 `createXxx()` 等 helper 生成测试数据
- **Mock**: 在 `src/tests/lib/` 放置 mock 设置

### 测试覆盖

- 正常情况 + 边界情况 + 异常情况
- 使用常量定义测试数据
- 独立、可重复运行

**创建日期**: 2026-03-19
**角色类型**: 测试代码编写者

# default-workflow intake layer env 加载方式调整说明

## 修改文件列表

- `package.json`
- `src/cli/index.ts`
- `src/default-workflow/index.ts`

## 改动摘要

- 回滚了在代码中主动读取 `.env` 的实现。
- 改为仅通过 Node 启动参数 `--env-file=.env` 加载环境变量。
- 新增两个启动脚本：
  - `pnpm cli`
  - `pnpm cli:build`

## 改动理由

- `.env` 的加载应当发生在 Node 进程启动阶段，而不是业务代码内部。
- 让 CLI 代码依赖 `.env` 文件路径会引入额外耦合，也会把环境装配逻辑混入业务入口。
- 当前 Node 版本支持 `--env-file`，因此可以只通过启动脚本完成环境注入。

## 未解决的不确定项

- 直接执行 `node dist/cli/index.js` 时，仍然不会自动加载 `.env`；需要改为 `node --env-file=.env dist/cli/index.js`，或者使用新增的 `pnpm cli` / `pnpm cli:build`。

## 自检结果

- 已做：
- 执行 `pnpm build`，通过。
- 执行 `pnpm test`，通过。
- 执行 `pnpm cli`，确认 CLI 可以基于 `.env` 正常启动。

- 未做：
- 无。

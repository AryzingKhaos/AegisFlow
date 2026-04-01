# codex-pty demo

## 修改文件列表

- `package.json`
- `demo/codex-pty.js`
- `demo/README.md`

## 改动摘要

- 新增 `demo/codex-pty.js`，使用 `node-pty` 启动 PTY shell，再由 shell 子命令行执行 `codex` CLI，并把当前终端输入输出桥接到 PTY 子进程。
- 新增 `demo/README.md`，补充 demo 的用途、运行方式和参数透传示例。
- 在 `package.json` 中新增 `demo:codex-pty` 脚本，方便直接启动 demo。

## 改动理由

- 用户需要一个放在 `demo/` 目录下的最小示例，用于验证“通过 `node-pty` 在子命令行调用 `codex` CLI”这件事本身。
- 该需求是独立 demo，不应该直接耦合进当前 `default-workflow` 主执行链路，因此采用单独脚本交付更合适。
- 增加 `package.json` 脚本和说明文档后，仓库内其他人可以直接复用，不需要先阅读主流程代码。

## 未解决的不确定项

- 该 demo 依赖本机 PATH 中存在可执行的 `codex` 命令；若本地未安装或未登录，脚本本身不会兜底处理认证与安装流程。
- 当前 demo 目标是演示 PTY 桥接，不包含更复杂的会话协议、输出结构化解析或多 role 路由能力。

## 自检结果

- 已做：静态检查脚本结构，确认使用了 `node-pty`、shell 子命令行执行 `codex`、参数透传、stdin/stdout 桥接、终端 resize 同步和子进程退出清理。
- 已做：尝试执行 `node demo/codex-pty.js --help` 与 `node demo/codex-pty.js -V`。
- 未通过：当前会话环境下 `node-pty` 创建 PTY 时报 `posix_spawnp failed`，连 `/bin/echo` 的最小 PTY 用例也同样失败，因此本次未能在当前运行环境完成真实 PTY 启动验证。
- 未做：没有为该 demo 新增自动化测试；原因是本次交付目标是最小交互式示例，优先保证可手动运行。

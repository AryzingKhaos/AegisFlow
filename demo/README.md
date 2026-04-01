# demo

## codex-pty

这个 demo 展示如何使用 `node-pty` 启动一个 PTY 子终端，并在其中通过 shell 子命令行执行本机的 `codex` CLI。

运行方式：

```bash
pnpm demo:codex-pty
```

如果你想把参数直接透传给 `codex`，可以这样运行：

```bash
pnpm demo:codex-pty -- --help
pnpm demo:codex-pty -- -V
pnpm demo:codex-pty -- exec "帮我总结当前目录结构"
```

说明：

- 这个脚本会把当前终端的输入输出直接桥接到 PTY 子进程
- `codex` 不是由 Node 直接启动，而是由 PTY 内的 shell 通过子命令行执行
- 终端窗口尺寸变化时，会同步 resize 到 `codex`
- 运行前需要本机已经可以直接执行 `codex`

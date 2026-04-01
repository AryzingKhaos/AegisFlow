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

## codex-pty-dual

这个 demo 展示如何同时启动两个 PTY 子终端，并在每个 PTY 中各自运行一个 `codex` CLI。父终端只显示当前激活的会话，你可以通过本地命令在两个 `codex` CLI 之间切换。

运行方式：

```bash
pnpm demo:codex-pty-dual
```

如果你想把参数同时透传给两个 `codex` 进程，可以这样运行：

```bash
pnpm demo:codex-pty-dual -- --help
pnpm demo:codex-pty-dual -- exec "帮我总结当前目录结构"
```

控制方式：

```text
Ctrl-A 或 Ctrl-]，然后输入：
switch 1
switch 2
list
help
quit
```

说明：

- 普通输入会原样透传给当前激活的 `codex` 会话，不再由 wrapper 拦截文本前缀
- 只有按下 `Ctrl-A` 或 `Ctrl-]` 才会进入外层控制命令模式，避免干扰内层 `codex` 的 TUI 输入
- `switch 1` / `switch 2` 由外层 demo 处理，不会发送给 `codex`
- 切换时会重绘目标会话的输出历史，便于继续在该 `codex` CLI 中交互
- 两个会话都会跟随当前终端窗口尺寸变化做 resize
- 控制模式下可用 `Esc` 或 `Ctrl-C` 取消
- 运行前需要本机已经可以直接执行 `codex`

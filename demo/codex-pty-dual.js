#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const pty = require("node-pty");

const MAX_HISTORY_BYTES = 200_000;
const CONTROL_PREFIXES = new Set(["\u0001", "\u001d"]);
const codexArgs = process.argv.slice(2);
const codexCommand = resolveExecutableFromPath("codex");
const shell = getPreferredShell();

const sessions = [createSession(0), createSession(1)];
let activeSessionIndex = 0;
let rawModeEnabled = false;
let localCommandState = createLocalCommandState();
let shuttingDown = false;

for (const session of sessions) {
  session.terminal.onData((data) => handleTerminalData(session, data));
  session.terminal.onExit(({ exitCode }) => handleTerminalExit(session, exitCode));
}

process.stdout.on("resize", handleResize);

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  rawModeEnabled = true;
}

process.stdin.resume();
process.stdin.on("data", handleStdinData);

process.on("SIGINT", () => {
  getActiveSession().terminal.kill("SIGINT");
});

process.on("SIGTERM", () => {
  for (const session of sessions) {
    if (!session.exited) {
      session.terminal.kill("SIGTERM");
    }
  }
});

renderActiveSession();

function createSession(index) {
  return {
    id: index + 1,
    exited: false,
    exitCode: null,
    history: "",
    terminal: pty.spawn(shell.file, [...shell.args, "-lc", buildShellCommand()], {
      name: process.env.TERM || "xterm-256color",
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      cwd: process.cwd(),
      env: { ...process.env },
    }),
  };
}

function createLocalCommandState() {
  return {
    mode: "passthrough",
    buffer: "",
  };
}

function getActiveSession() {
  return sessions[activeSessionIndex];
}

function handleTerminalData(session, data) {
  appendHistory(session, data);

  if (session.id === getActiveSession().id) {
    process.stdout.write(data);
  }
}

function handleTerminalExit(session, exitCode) {
  session.exited = true;
  session.exitCode = exitCode;

  const message = `\r\n[dual-codex] 会话 ${session.id} 已退出，exit code=${exitCode}\r\n`;
  appendHistory(session, message);

  if (session.id === getActiveSession().id) {
    process.stdout.write(message);
  }

  const aliveSessions = sessions.filter((item) => !item.exited);

  if (aliveSessions.length === 0) {
    cleanup();
    process.exit(shuttingDown ? 0 : exitCode);
  }

  if (shuttingDown) {
    return;
  }

  if (session.id === getActiveSession().id) {
    const nextSession = aliveSessions[0];
    switchToSession(nextSession.id, {
      extraLines: [`[dual-codex] 当前会话已退出，自动切换到会话 ${nextSession.id}。`],
    });
  }
}

function handleResize() {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;

  for (const session of sessions) {
    if (!session.exited) {
      session.terminal.resize(cols, rows);
    }
  }
}

function handleStdinData(chunk) {
  const input = chunk.toString("utf8");

  if (localCommandState.mode === "passthrough") {
    handlePassthroughInput(input);
    return;
  }

  handleControlInput(input);
}

function handlePassthroughInput(input) {
  let passthroughBuffer = "";

  for (const char of input) {
    if (CONTROL_PREFIXES.has(char)) {
      if (passthroughBuffer.length > 0) {
        forwardInputToActiveSession(passthroughBuffer);
        passthroughBuffer = "";
      }

      enterControlMode();
      continue;
    }

    if (localCommandState.mode === "control") {
      handleControlChar(char);
      continue;
    }

    passthroughBuffer += char;
  }

  if (passthroughBuffer.length > 0) {
    forwardInputToActiveSession(passthroughBuffer);
  }
}

function handleControlInput(input) {
  for (const char of input) {
    handleControlChar(char);
  }
}

function handleControlChar(char) {
  if (char === "\u0003") {
    process.stdout.write("^C\r\n");
    localCommandState = createLocalCommandState();
    return;
  }

  if (char === "\u001b") {
    process.stdout.write("[dual-codex] 已取消控制命令。\r\n");
    localCommandState = createLocalCommandState();
    return;
  }

  if (char === "\r" || char === "\n") {
    process.stdout.write("\r\n");
    const command = localCommandState.buffer.trim();
    localCommandState = createLocalCommandState();
    executeLocalCommand(command);
    return;
  }

  if (char === "\u007f") {
    if (localCommandState.buffer.length > 0) {
      localCommandState.buffer = localCommandState.buffer.slice(0, -1);
      process.stdout.write("\b \b");
    }
    return;
  }

  if (isPrintableChar(char)) {
    localCommandState.buffer += char;
    process.stdout.write(char);
  }
}

function enterControlMode() {
  localCommandState.mode = "control";
  localCommandState.buffer = "";
  process.stdout.write("\r\n[dual-codex] control> ");
}

function executeLocalCommand(command) {
  if (command.length === 0 || command === "help") {
    printLocalHelp();
    return;
  }

  if (command === "list") {
    printSessionList();
    return;
  }

  if (command === "quit" || command === "exit") {
    shutdownAllSessions();
    return;
  }

  const switchMatch = command.match(/^switch\s+([12])$/);

  if (switchMatch) {
    switchToSession(Number(switchMatch[1]), {
      extraLines: [`[dual-codex] 已切换到会话 ${switchMatch[1]}。`],
    });
    return;
  }

  process.stdout.write(`[dual-codex] 未知本地命令: ${command}\r\n`);
  printLocalHelp();
}

function printLocalHelp() {
  process.stdout.write("[dual-codex] 控制命令帮助:\r\n");
  process.stdout.write("  先按 Ctrl-A 或 Ctrl-] 进入控制模式，再输入以下命令并回车:\r\n");
  process.stdout.write("  switch 1    切到会话 1\r\n");
  process.stdout.write("  switch 2    切到会话 2\r\n");
  process.stdout.write("  list        查看两个会话状态\r\n");
  process.stdout.write("  help        查看帮助\r\n");
  process.stdout.write("  quit        关闭两个 codex 会话并退出 demo\r\n");
  process.stdout.write("  Esc / Ctrl-C 取消控制模式\r\n");
}

function printSessionList() {
  for (const session of sessions) {
    const status = session.exited ? `exited (${session.exitCode})` : "running";
    const active = session.id === getActiveSession().id ? "active" : "inactive";
    process.stdout.write(`[dual-codex] 会话 ${session.id}: ${status}, ${active}\r\n`);
  }
}

function switchToSession(sessionId, options = {}) {
  const nextIndex = sessions.findIndex((session) => session.id === sessionId);

  if (nextIndex === -1) {
    process.stdout.write(`[dual-codex] 会话 ${sessionId} 不存在。\r\n`);
    return;
  }

  const nextSession = sessions[nextIndex];

  if (nextSession.exited) {
    process.stdout.write(`[dual-codex] 会话 ${sessionId} 已退出，无法切换。\r\n`);
    return;
  }

  activeSessionIndex = nextIndex;
  renderActiveSession(options);
}

function renderActiveSession(options = {}) {
  clearScreen();

  const extraLines = options.extraLines || [];

  process.stdout.write("[dual-codex] 已启动两个 codex CLI 会话。\r\n");
  process.stdout.write("[dual-codex] 控制前缀: Ctrl-A 或 Ctrl-]，随后输入 switch 1 | switch 2 | list | help | quit\r\n");
  process.stdout.write(`[dual-codex] 当前会话: ${getActiveSession().id}\r\n`);

  for (const line of extraLines) {
    process.stdout.write(`${line}\r\n`);
  }

  process.stdout.write("\r\n");

  const history = getActiveSession().history;

  if (history.length > 0) {
    process.stdout.write(history);
  }
}

function forwardInputToActiveSession(value) {
  if (getActiveSession().exited) {
    process.stdout.write("[dual-codex] 当前会话已退出，请先切换到仍在运行的会话。\r\n");
    return;
  }

  getActiveSession().terminal.write(value);
}

function appendHistory(session, chunk) {
  session.history += chunk;

  if (session.history.length > MAX_HISTORY_BYTES) {
    session.history = session.history.slice(session.history.length - MAX_HISTORY_BYTES);
  }
}

function shutdownAllSessions() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const session of sessions) {
    if (!session.exited) {
      session.terminal.kill("SIGTERM");
    }
  }
}

function cleanup() {
  process.stdin.off("data", handleStdinData);
  process.stdout.off("resize", handleResize);

  if (process.stdin.isTTY) {
    process.stdin.pause();

    if (rawModeEnabled) {
      process.stdin.setRawMode(false);
      rawModeEnabled = false;
    }
  }
}

function buildShellCommand() {
  const escapedArgs = codexArgs.map(escapeShellArg).join(" ");
  const command = [escapeShellArg(codexCommand), escapedArgs]
    .filter((segment) => segment.length > 0)
    .join(" ");

  return `exec ${command}`;
}

function getPreferredShell() {
  const shellPath = process.env.SHELL?.trim();

  if (shellPath) {
    return {
      file: shellPath,
      args: [],
    };
  }

  return {
    file: "/bin/sh",
    args: [],
  };
}

function clearScreen() {
  process.stdout.write("\u001b[2J\u001b[H");
}

function isPrintableChar(char) {
  return char >= " " && char !== "\u007f";
}

function escapeShellArg(value) {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function resolveExecutableFromPath(command) {
  const pathValue = process.env.PATH || "";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];

  for (const baseDir of pathValue.split(path.delimiter)) {
    if (!baseDir) {
      continue;
    }

    for (const extension of extensions) {
      const candidate = path.join(baseDir, `${command}${extension}`);

      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }

  throw new Error(
    'Unable to find "codex" in PATH. Please install Codex CLI or add it to PATH before running this demo.',
  );
}

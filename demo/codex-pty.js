#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const pty = require("node-pty");

const codexArgs = process.argv.slice(2);
const codexCommand = resolveExecutableFromPath("codex");
const shell = getPreferredShell();
const terminal = pty.spawn(shell.file, [...shell.args, "-lc", buildShellCommand()], {
  name: process.env.TERM || "xterm-256color",
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
  cwd: process.cwd(),
  env: { ...process.env },
});

let rawModeEnabled = false;

const handleTerminalData = (data) => {
  process.stdout.write(data);
};

const handleStdinData = (chunk) => {
  terminal.write(chunk.toString());
};

const handleResize = () => {
  terminal.resize(process.stdout.columns || 80, process.stdout.rows || 24);
};

const cleanup = () => {
  process.stdin.off("data", handleStdinData);
  process.stdout.off("resize", handleResize);

  if (process.stdin.isTTY) {
    process.stdin.pause();

    if (rawModeEnabled) {
      process.stdin.setRawMode(false);
      rawModeEnabled = false;
    }
  }
};

terminal.onData(handleTerminalData);
terminal.onExit(({ exitCode }) => {
  cleanup();
  process.exit(exitCode);
});

process.stdout.on("resize", handleResize);

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  rawModeEnabled = true;
}

process.stdin.resume();
process.stdin.on("data", handleStdinData);

process.on("SIGINT", () => {
  terminal.kill("SIGINT");
});

process.on("SIGTERM", () => {
  terminal.kill("SIGTERM");
});

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

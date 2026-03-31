import readline from "node:readline";
import { IntakeAgent } from "../default-workflow";
import { writeCliLine } from "./output";

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let isClosed = false;
  let isBusy = false;
  let pendingWork = Promise.resolve();
  const stdoutWriter = process.stdout as {
    write: (chunk: string) => unknown;
  };

  const printLines = (lines: string[]): void => {
    if (lines.length === 0) {
      return;
    }

    for (const line of lines) {
      writeCliLine(stdoutWriter, line);
    }

    if (!isClosed && !isBusy) {
      rl.prompt();
    }
  };

  const agent = new IntakeAgent(process.cwd(), {
    onWorkflowOutput: printLines,
  });

  const prompt = (): void => {
    if (!isClosed) {
      rl.prompt();
    }
  };

  printLines(agent.getBootstrapLines());
  rl.setPrompt("> ");
  prompt();

  const enqueue = (work: () => Promise<void>): void => {
    pendingWork = pendingWork
      .then(async () => {
        isBusy = true;
        await work();
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`CLI 处理失败：${message}`);
      })
      .finally(() => {
        isBusy = false;
        prompt();
      });
  };

  rl.on("line", (line) => {
    enqueue(async () => {
      printLines(await agent.handleUserInput(line));
    });
  });

  rl.on("SIGINT", () => {
    enqueue(async () => {
      const result = await agent.handleInterruptSignal();
      printLines(result.lines);

      if (result.shouldExit) {
        isClosed = true;
        rl.close();
      }
    });
  });

  rl.on("close", () => {
    isClosed = true;
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CLI 启动失败：${message}`);
  process.exitCode = 1;
});

import readline from "node:readline";
import { IntakeAgent } from "../default-workflow";

async function main(): Promise<void> {
  const agent = new IntakeAgent(process.cwd());
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let isClosed = false;
  let pendingWork = Promise.resolve();

  const printLines = (lines: string[]): void => {
    for (const line of lines) {
      console.log(line);
    }
  };

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
      .then(work)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`CLI 处理失败：${message}`);
      })
      .finally(() => {
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

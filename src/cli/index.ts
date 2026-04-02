import { runCliApp } from "./app";

void runCliApp().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`CLI 启动失败：${message}`);
  process.exitCode = 1;
});

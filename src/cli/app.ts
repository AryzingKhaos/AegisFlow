declare const require: (id: string) => unknown;

import { IntakeAgent } from "../default-workflow";
import type { WorkflowEvent } from "../default-workflow/shared/types";
import {
  appendSystemLines,
  applyWorkflowEventToCliViewModel,
  createInitialCliViewModel,
  type CliViewModel,
  type UiBlock,
} from "./ui-model";

const React = require("react") as {
  createElement: (...args: unknown[]) => unknown;
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  useRef: <T>(value: T) => { current: T };
  useState: <T>(
    initialValue: T | (() => T),
  ) => [T, (value: T | ((previous: T) => T)) => void];
};
const importModule = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<any>;

let Box: unknown;
let Text: unknown;
let useApp: () => { exit: () => void };
let useInput: (
  handler: (
    input: string,
    key: {
      return?: boolean;
      backspace?: boolean;
      delete?: boolean;
      ctrl?: boolean;
    },
  ) => void,
) => void;
let renderApp: (node: unknown) => unknown;

interface InkModuleShape {
  Box: unknown;
  Text: unknown;
  render: (node: unknown) => unknown;
  useApp: () => { exit: () => void };
  useInput: (
    handler: (
      input: string,
      key: {
        return?: boolean;
        backspace?: boolean;
        delete?: boolean;
        ctrl?: boolean;
      },
    ) => void,
  ) => void;
}

const h = React.createElement;

const THEME = {
  accent: "#7f1d1d",
  accentSoft: "#b91c1c",
  text: "#f5f5f4",
  muted: "#a8a29e",
  subdued: "#78716c",
  intermediate: "#9ca3af",
  error: "#f87171",
  border: "#450a0a",
  panel: "#1c1917",
};

export async function runCliApp(): Promise<unknown> {
  if (!renderApp) {
    const inkModule = (await importModule("ink")) as InkModuleShape;
    Box = inkModule.Box;
    Text = inkModule.Text;
    useApp = inkModule.useApp;
    useInput = inkModule.useInput;
    renderApp = inkModule.render;
  }

  return renderApp(h(IntakeInkApp));
}

function IntakeInkApp(): unknown {
  const { exit } = useApp();
  const [input, setInput] = React.useState("");
  const [isBusy, setIsBusy] = React.useState(false);
  const [viewModel, setViewModel] = React.useState<CliViewModel>(() =>
    createInitialCliViewModel([]),
  );
  const pendingWorkRef = React.useRef(Promise.resolve());
  const pendingLiveInputRef = React.useRef(Promise.resolve());
  const isDisposedRef = React.useRef(false);
  const agentRef = React.useRef<IntakeAgent | null>(null);

  if (!agentRef.current) {
    agentRef.current = new IntakeAgent(process.cwd(), {
      onWorkflowOutput() {
        return;
      },
      onWorkflowEvent(event: WorkflowEvent) {
        setViewModel((previous) => applyWorkflowEventToCliViewModel(previous, event));
      },
    });
  }

  const agent = agentRef.current;

  React.useEffect(() => {
    setViewModel((previous) =>
      appendSystemLines(previous, agent.getBootstrapLines(), "启动信息"),
    );

    return () => {
      if (isDisposedRef.current) {
        return;
      }

      isDisposedRef.current = true;
      void agent.dispose();
    };
  }, [agent]);

  useInput((typedInput, key) => {
    if (key.ctrl && typedInput.toLowerCase() === "c") {
      enqueue(async () => {
        const result = await agent.handleInterruptSignal();
        pushSystemLines(result.lines, "中断结果");

        if (result.shouldExit) {
          await disposeAgent();
          exit();
        }
      });
      return;
    }

    if (key.return) {
      const submittedInput = input;
      setInput("");

      if (agent.shouldHandleInputAsLiveParticipation(submittedInput)) {
        enqueueLiveInput(async () => {
          pushSystemLines(await agent.handleUserInput(submittedInput), "补充输入");
        });
        return;
      }

      enqueue(async () => {
        pushSystemLines(await agent.handleUserInput(submittedInput), "系统消息");
      });
      return;
    }

    if (key.backspace || key.delete) {
      setInput((previous) => previous.slice(0, -1));
      return;
    }

    if (typedInput.length > 0) {
      setInput((previous) => `${previous}${typedInput}`);
    }
  });

  return h(
    Box,
    {
      flexDirection: "column",
      paddingX: 1,
      paddingY: 1,
    },
    h(StatusBar, {
      viewModel,
      isBusy,
    }),
    h(
      Box,
      {
        flexDirection: "column",
        marginTop: 1,
      },
      h(ContentSection, {
        title: "结果与事件",
        borderColor: THEME.border,
        children: [
          viewModel.finalBlocks.length > 0
            ? viewModel.finalBlocks.map((block) =>
                h(ResultBlock, {
                  key: block.id,
                  block,
                }),
              )
            : [
                h(
                  Text,
                  {
                    key: "empty-results",
                    color: THEME.subdued,
                  },
                  "等待输入。",
                ),
              ],
        ].flat(),
      }),
      h(ContentSection, {
        title: "骨架事件",
        borderColor: THEME.border,
        marginTop: 1,
        children:
          viewModel.skeletonBlocks.length > 0
            ? viewModel.skeletonBlocks.map((block) =>
                h(SkeletonBlock, {
                  key: block.id,
                  block,
                }),
              )
            : [
                h(
                  Text,
                  {
                    key: "empty-skeleton",
                    color: THEME.subdued,
                  },
                  "暂无骨架事件。",
                ),
              ],
      }),
      h(IntermediateOutputPanel, {
        lines: viewModel.intermediateLines,
      }),
    ),
    h(InputBar, {
      input,
      viewModel,
      isBusy,
    }),
  );

  function enqueue(work: () => Promise<void>): void {
    pendingWorkRef.current = pendingWorkRef.current
      .then(async () => {
        setIsBusy(true);
        await work();
      })
      .catch((error) => {
        pushSystemLines(
          [
            `CLI 处理失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          ],
          "执行错误",
        );
      })
      .finally(() => {
        setIsBusy(false);
      });
  }

  function enqueueLiveInput(work: () => Promise<void>): void {
    pendingLiveInputRef.current = pendingLiveInputRef.current
      .then(work)
      .catch((error) => {
        pushSystemLines(
          [
            `CLI 实时透传失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          ],
          "执行错误",
        );
      });
  }

  async function disposeAgent(): Promise<void> {
    if (isDisposedRef.current) {
      return;
    }

    isDisposedRef.current = true;
    await agent.dispose();
  }

  function pushSystemLines(lines: string[], title: string): void {
    setViewModel((previous) => appendSystemLines(previous, lines, title));
  }
}

function StatusBar(input: {
  viewModel: CliViewModel;
  isBusy: boolean;
}): unknown {
  return h(
    Box,
    {
      borderStyle: "round",
      borderColor: THEME.accent,
      paddingX: 1,
      paddingY: 0,
      flexDirection: "column",
    },
    h(
      Box,
      {
        justifyContent: "space-between",
      },
      h(
        Text,
        {
          color: THEME.accentSoft,
          bold: true,
        },
        input.viewModel.appTitle,
      ),
      h(
        Text,
        {
          color: input.isBusy ? THEME.accentSoft : THEME.muted,
        },
        input.isBusy ? "BUSY" : "READY",
      ),
    ),
    h(
      Box,
      {
        marginTop: 0,
        flexDirection: "row",
      },
      h(Text, { color: THEME.text }, `任务：${input.viewModel.sessionTitle}`),
      h(Text, { color: THEME.subdued }, "  |  "),
      h(Text, { color: THEME.text }, `阶段：${input.viewModel.currentPhase}`),
      h(Text, { color: THEME.subdued }, "  |  "),
      h(Text, { color: THEME.text }, `状态：${input.viewModel.taskStatus}`),
    ),
  );
}

function ContentSection(input: {
  title: string;
  borderColor: string;
  marginTop?: number;
  children: unknown[];
}): unknown {
  return h(
    Box,
    {
      marginTop: input.marginTop ?? 0,
      borderStyle: "round",
      borderColor: input.borderColor,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Text,
      {
        color: THEME.accentSoft,
        bold: true,
      },
      input.title,
    ),
    h(
      Box,
      {
        marginTop: 1,
        flexDirection: "column",
      },
      ...input.children,
    ),
  );
}

function ResultBlock(input: { block: UiBlock }): unknown {
  return h(
    Box,
    {
      marginBottom: 1,
      flexDirection: "column",
    },
    h(
      Text,
      {
        color: resolveToneColor(input.block.tone),
        bold: input.block.tone !== "muted",
      },
      input.block.title,
    ),
    h(
      Text,
      {
        color: THEME.text,
      },
      input.block.body,
    ),
  );
}

function SkeletonBlock(input: { block: UiBlock }): unknown {
  return h(
    Box,
    {
      marginBottom: 1,
      flexDirection: "column",
    },
    h(
      Text,
      {
        color: THEME.subdued,
      },
      `${input.block.title} · ${input.block.body}`,
    ),
  );
}

function IntermediateOutputPanel(input: { lines: string[] }): unknown {
  return h(
    Box,
    {
      marginTop: 1,
      borderStyle: "round",
      borderColor: THEME.border,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Text,
      {
        color: THEME.accentSoft,
        bold: true,
      },
      "过程输出",
    ),
    h(
      Box,
      {
        marginTop: 1,
        flexDirection: "column",
      },
      ...(input.lines.length > 0
        ? input.lines.map((line, index) =>
            h(
              Text,
              {
                key: `intermediate_${String(index)}`,
                color: THEME.intermediate,
              },
              line,
            ),
          )
        : [
            h(
              Text,
              {
                key: "empty-intermediate",
                color: THEME.subdued,
              },
              "暂无中间输出。",
            ),
          ]),
    ),
  );
}

function InputBar(input: {
  input: string;
  viewModel: CliViewModel;
  isBusy: boolean;
}): unknown {
  return h(
    Box,
    {
      marginTop: 1,
      borderStyle: "round",
      borderColor: THEME.accent,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Text,
      {
        color: THEME.accentSoft,
        bold: true,
      },
      "输入",
    ),
    h(
      Text,
      {
        color: THEME.muted,
      },
      input.viewModel.inputHint,
    ),
    h(
      Text,
      {
        color: input.isBusy ? THEME.subdued : THEME.text,
      },
      `> ${input.input}${input.isBusy ? "" : "█"}`,
    ),
  );
}

function resolveToneColor(tone: UiBlock["tone"]): string {
  switch (tone) {
    case "accent":
      return THEME.accentSoft;
    case "error":
      return THEME.error;
    case "muted":
      return THEME.muted;
    default:
      return THEME.text;
  }
}

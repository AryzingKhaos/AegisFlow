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
import {
  compactSkeletonBody,
  resolveResultToneStyle,
  THEME,
} from "./theme";

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
      h(PrimaryResultArea, {
        blocks: viewModel.finalBlocks,
      }),
      h(SkeletonArea, {
        blocks: viewModel.skeletonBlocks,
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
      borderColor: THEME.chrome.border,
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
          color: THEME.chrome.appAccent,
          bold: true,
        },
        input.viewModel.appTitle,
      ),
      h(
        Text,
        {
          color: input.isBusy ? THEME.status.busy : THEME.status.ready,
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
      h(Text, { color: THEME.status.label }, `任务：${input.viewModel.sessionTitle}`),
      h(Text, { color: THEME.status.separator }, "  |  "),
      h(Text, { color: THEME.status.label }, `阶段：${input.viewModel.currentPhase}`),
      h(Text, { color: THEME.status.separator }, "  |  "),
      h(Text, { color: THEME.status.label }, `状态：${input.viewModel.taskStatus}`),
    ),
  );
}

function PrimaryResultArea(input: {
  blocks: UiBlock[];
}): unknown {
  return h(
    Box,
    {
      borderStyle: "round",
      borderColor: THEME.result.border,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Text,
      {
        color: THEME.result.title,
        bold: true,
      },
      "主结果",
    ),
    h(
      Box,
      {
        marginTop: 1,
        flexDirection: "column",
      },
      ...(input.blocks.length > 0
        ? input.blocks.map((block, index) =>
            h(ResultBlock, {
              key: block.id,
              block,
              isLast: index === input.blocks.length - 1,
            }),
          )
        : [
            h(
              Text,
              {
                key: "empty-results",
                color: THEME.text.dim,
              },
              "等待输入，主结果会优先显示在这里。",
            ),
          ]),
    ),
  );
}

function ResultBlock(input: {
  block: UiBlock;
  isLast: boolean;
}): unknown {
  const toneStyle = resolveResultToneStyle(input.block.tone);

  return h(
    Box,
    {
      marginBottom: input.isLast ? 0 : 1,
      flexDirection: "column",
      borderStyle: "round",
      borderColor: toneStyle.border,
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Box,
      {
        flexDirection: "column",
      },
      h(
        Text,
        {
          color: toneStyle.eyebrow,
        },
        input.block.tone === "error" ? "ERROR" : input.block.tone === "system" ? "SYSTEM" : "RESULT",
      ),
      h(
        Text,
        {
          color: toneStyle.title,
          bold: true,
        },
        input.block.title,
      ),
    ),
    h(
      Box,
      {
        marginTop: 1,
      },
      h(
        Text,
        {
          color: toneStyle.body,
        },
        input.block.body,
      ),
    ),
  );
}

function SkeletonArea(input: { blocks: UiBlock[] }): unknown {
  return h(
    Box,
    {
      marginTop: 1,
      borderStyle: "single",
      borderColor: THEME.skeleton.border,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Text,
      {
        color: THEME.skeleton.title,
        bold: true,
      },
      "流程骨架",
    ),
    h(
      Box,
      {
        marginTop: 1,
        flexDirection: "column",
      },
      ...(input.blocks.length > 0
        ? input.blocks.map((block) =>
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
                color: THEME.skeleton.detail,
              },
              "暂无骨架事件。",
            ),
          ]),
    ),
  );
}

function SkeletonBlock(input: { block: UiBlock }): unknown {
  return h(
    Box,
    {
      marginBottom: 1,
      flexDirection: "row",
    },
    h(
      Text,
      {
        color: THEME.skeleton.title,
      },
      `${input.block.title}: `,
    ),
    h(
      Text,
      {
        color: THEME.skeleton.event,
      },
      compactSkeletonBody(input.block.body),
    ),
  );
}

function IntermediateOutputPanel(input: { lines: string[] }): unknown {
  return h(
    Box,
    {
      marginTop: 1,
      borderStyle: "round",
      borderColor: THEME.intermediate.border,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Text,
      {
        color: THEME.intermediate.title,
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
                color: THEME.intermediate.line,
              },
              line,
            ),
          )
        : [
            h(
              Text,
              {
                key: "empty-intermediate",
                color: THEME.intermediate.empty,
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
      borderColor: THEME.input.border,
      flexDirection: "column",
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Text,
      {
        color: THEME.input.title,
        bold: true,
      },
      "输入",
    ),
    h(
      Text,
      {
        color: THEME.input.hint,
      },
      input.viewModel.inputHint,
    ),
    h(
      Text,
      {
        color: input.isBusy ? THEME.input.busyValue : THEME.input.value,
      },
      `> ${input.input}${input.isBusy ? "" : "_"}`,
    ),
  );
}

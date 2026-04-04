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
  skeleton: "#93c5fd",
  result: "#e7e5e4",
  error: "#f87171",
  border: "#450a0a",
  panel: "#1c1917",
};

const MAX_VISIBLE_INTERMEDIATE_LINES = 3;
const SPINNER_FRAMES = ["-", "\\", "|", "/"];

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
  const interruptPendingRef = React.useRef(false);
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

    const handleSigint = () => {
      requestInterrupt();
    };

    process.on?.("SIGINT", handleSigint);

    return () => {
      process.removeListener?.("SIGINT", handleSigint);

      if (isDisposedRef.current) {
        return;
      }

      isDisposedRef.current = true;
      void agent.dispose();
    };
  }, [agent]);

  useInput((typedInput, key) => {
    if (key.ctrl && typedInput.toLowerCase() === "c") {
      requestInterrupt();
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
      h(OutputPanel, {
        viewModel,
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

  function requestInterrupt(): void {
    if (interruptPendingRef.current) {
      return;
    }

    interruptPendingRef.current = true;
    enqueue(async () => {
      try {
        const result = await agent.handleInterruptSignal();
        pushSystemLines(result.lines, "中断结果");

        if (result.shouldExit) {
          await disposeAgent();
          exit();
        }
      } finally {
        interruptPendingRef.current = false;
      }
    });
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

function OutputPanel(input: { viewModel: CliViewModel }): unknown {
  const isRunning = input.viewModel.taskStatus === "running";
  const [spinnerIndex, setSpinnerIndex] = React.useState(0);

  React.useEffect(() => {
    if (!isRunning) {
      setSpinnerIndex(0);
      return;
    }

    const timer = setInterval(() => {
      setSpinnerIndex((previous) => (previous + 1) % SPINNER_FRAMES.length);
    }, 120);

    return () => {
      clearInterval(timer);
    };
  }, [isRunning]);

  const intermediateLabel = isRunning
    ? `${SPINNER_FRAMES[spinnerIndex]} [过程输出]`
    : "[过程输出]";
  const entries = buildOutputEntries(input.viewModel, intermediateLabel);

  return h(ContentSection, {
    title: "输出",
    borderColor: THEME.border,
    children:
      entries.length > 0
        ? entries
        : [
            h(
              Text,
              {
                key: "empty-output",
                color: THEME.subdued,
              },
              "等待输入。",
            ),
          ],
  });
}

function LabeledBlock(input: {
  label: string;
  value: string;
  color: string;
  bold?: boolean;
}): unknown {
  const prefix = `${input.label} `;
  const padding = " ".repeat(prefix.length);
  const normalizedValue = normalizeDisplayNewlines(input.value);
  const lines = normalizedValue.length > 0 ? normalizedValue.split("\n") : [""];

  return h(
    Box,
    {
      marginBottom: 1,
      flexDirection: "column",
    },
    ...lines.map((line, index) =>
      h(
        Text,
        {
          key: `line_${String(index)}`,
          color: input.color,
          bold: input.bold ?? false,
        },
        `${index === 0 ? prefix : padding}${line}`,
      ),
    ),
  );
}

function buildOutputEntries(
  viewModel: CliViewModel,
  intermediateLabel: string,
): unknown[] {
  const flattenedIntermediateLines = viewModel.intermediateLines.flatMap((line) =>
    normalizeDisplayNewlines(line).split("\n"),
  );
  const visibleIntermediateLines = flattenedIntermediateLines.slice(
    0,
    MAX_VISIBLE_INTERMEDIATE_LINES,
  );
  const hasOmittedIntermediateLines =
    flattenedIntermediateLines.length > MAX_VISIBLE_INTERMEDIATE_LINES;

  return [
    ...viewModel.finalBlocks.map((block) =>
      h(LabeledBlock, {
        key: block.id,
        label: "[结果输出]",
        color: resolveFinalBlockColor(block.tone),
        value: block.title ? `${block.title} [${block.body}]` : block.body,
        bold: block.tone !== "muted",
      }),
    ),
    ...viewModel.skeletonBlocks.map((block) =>
      h(LabeledBlock, {
        key: block.id,
        label: "[骨架输出]",
        color: THEME.skeleton,
        value: formatSkeletonBlockValue(block),
      }),
    ),
    ...(visibleIntermediateLines.length > 0
      ? [
          h(LabeledBlock, {
            key: "intermediate_group",
            label: intermediateLabel,
            color: THEME.intermediate,
            value: hasOmittedIntermediateLines
              ? `${visibleIntermediateLines.join("\n")}\n...`
              : visibleIntermediateLines.join("\n"),
          }),
        ]
      : []),
  ];
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
    case "result":
      return THEME.result;
    case "error":
      return THEME.error;
    case "muted":
      return THEME.muted;
    default:
      return THEME.text;
  }
}

function resolveFinalBlockColor(tone: UiBlock["tone"]): string {
  if (tone === "error") {
    return THEME.error;
  }

  if (tone === "accent") {
    return THEME.accentSoft;
  }

  return THEME.result;
}

function formatSkeletonBlockValue(block: UiBlock): string {
  const body = formatSkeletonBodyForDisplay(block.body);

  if (!block.title) {
    return body;
  }

  if (!body) {
    return block.title;
  }

  return `${block.title}\n${body}`;
}

function formatSkeletonBodyForDisplay(body: string): string {
  return normalizeDisplayNewlines(body)
    .replace(/，(?=(当前|目标|工件|状态|阶段|角色|结果|原因|恢复点))/g, "，\n")
    .replace(/。(?=(当前|目标|工件|状态|阶段|角色|结果|原因|恢复点))/g, "。\n")
    .replace(
      /,(?=\s*(currentPhase|status|phaseStatus|resumeFrom|artifactPath|roleName|phase)\b)/g,
      ",\n",
    );
}

function normalizeDisplayNewlines(value: string): string {
  return value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n");
}

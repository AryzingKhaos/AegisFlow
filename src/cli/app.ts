declare const require: (id: string) => unknown;

import { IntakeAgent } from "../default-workflow";
import { createIntakeErrorViewFromUnknown } from "../default-workflow/intake/error-view";
import type { WorkflowEvent } from "../default-workflow/shared/types";
import {
  appendIntakeError,
  appendSystemLines,
  applyWorkflowEventToCliViewModel,
  clearCliError,
  createInitialCliViewModel,
  type CliViewModel,
  type UiBlock,
} from "./ui-model";
import { resolveResultToneStyle, THEME } from "./theme";

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
) as (specifier: string) => Promise<unknown>;

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
const MAX_VISIBLE_INTERMEDIATE_LINES_IDLE = 3;
const MAX_VISIBLE_INTERMEDIATE_LINES_RUNNING = 7;
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
      onIntakeError(error) {
        setViewModel((previous) => appendIntakeError(previous, error));
      },
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
      setViewModel((previous) => clearCliError(previous));

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
    viewModel.currentError
      ? h(ErrorPanel, {
          error: viewModel.currentError,
        })
      : null,
    h(OutputPanel, {
      viewModel,
    }),
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
        setViewModel((previous) =>
          appendIntakeError(
            previous,
            createIntakeErrorViewFromUnknown(error, {
              summary: "CLI 处理失败。",
              location: "入口：Intake CLI",
              source: "cli",
            }),
          ),
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
        setViewModel((previous) =>
          appendIntakeError(
            previous,
            createIntakeErrorViewFromUnknown(error, {
              summary: "CLI 实时透传失败。",
              location: "入口：Intake CLI",
              source: "cli",
            }),
          ),
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

function ErrorPanel(input: {
  error: NonNullable<CliViewModel["currentError"]>;
}): unknown {
  const children = [
    h(
      Text,
      {
        key: "error-summary",
        color: THEME.text.primary,
        bold: true,
      },
      input.error.summary,
    ),
    h(LabeledBlock, {
      key: "error-reason",
      label: "[失败原因]",
      value: input.error.reason,
      color: THEME.error.body,
      bold: true,
    }),
  ];

  if (input.error.location) {
    children.push(
      h(LabeledBlock, {
        key: "error-location",
        label: "[失败位置]",
        value: input.error.location,
        color: THEME.text.secondary,
      }),
    );
  }

  if (input.error.nextAction) {
    children.push(
      h(LabeledBlock, {
        key: "error-next-action",
        label: "[下一步建议]",
        value: input.error.nextAction,
        color: THEME.chrome.appAccentSoft,
      }),
    );
  }

  return h(ContentSection, {
    title: "错误说明",
    borderColor: THEME.error.border,
    titleColor: THEME.error.title,
    marginTop: 1,
    children,
  });
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
  const entries = buildOutputEntries(
    input.viewModel,
    intermediateLabel,
    isRunning
      ? MAX_VISIBLE_INTERMEDIATE_LINES_RUNNING
      : MAX_VISIBLE_INTERMEDIATE_LINES_IDLE,
  );

  return h(ContentSection, {
    title: "输出",
    borderColor: THEME.chrome.borderMuted,
    titleColor: THEME.text.secondary,
    marginTop: 1,
    children:
      entries.length > 0
        ? entries
        : [
            h(
              Text,
              {
                key: "empty-output",
                color: THEME.text.dim,
              },
              "等待输入。",
            ),
          ],
  });
}

function ContentSection(input: {
  title: string;
  borderColor: string;
  titleColor?: string;
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
        color: input.titleColor ?? THEME.text.secondary,
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
  maxVisibleIntermediateLines: number,
): unknown[] {
  const orderedBlocks = [
    ...viewModel.finalBlocks.map((block) => ({
      kind: "final" as const,
      block,
    })),
    ...viewModel.skeletonBlocks.map((block) => ({
      kind: "skeleton" as const,
      block,
    })),
  ].sort((left, right) => left.block.order - right.block.order);
  const flattenedIntermediateLines = viewModel.intermediateLines.flatMap((line) =>
    normalizeDisplayNewlines(line).split("\n"),
  );
  const visibleIntermediateLines = flattenedIntermediateLines.slice(
    0,
    maxVisibleIntermediateLines,
  );
  const hasOmittedIntermediateLines =
    flattenedIntermediateLines.length > maxVisibleIntermediateLines;

  return [
    ...orderedBlocks.map(({ kind, block }) =>
      h(LabeledBlock, {
        key: block.id,
        label: kind === "skeleton" ? "[骨架输出]" : "[结果输出]",
        color:
          kind === "skeleton"
            ? THEME.skeleton.event
            : resolveFinalBlockColor(block.tone),
        value:
          kind === "skeleton"
            ? formatSkeletonBlockValue(block)
            : block.title
              ? `${block.title} [${block.body}]`
              : block.body,
        bold: kind === "skeleton" ? false : block.tone !== "system",
      }),
    ),
    ...(visibleIntermediateLines.length > 0
      ? [
          h(LabeledBlock, {
            key: "intermediate_group",
            label: intermediateLabel,
            color: THEME.intermediate.line,
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

function resolveFinalBlockColor(tone: UiBlock["tone"]): string {
  return resolveResultToneStyle(tone).body;
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

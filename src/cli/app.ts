declare const require: (id: string) => unknown;

import { IntakeAgent } from "../default-workflow";
import {
  createIntakeErrorViewFromUnknown,
  isCodexExecInterruption,
} from "../default-workflow/intake/error-view";
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
import {
  buildOutputRegionLayout,
  type MainOutputEntry,
  normalizeDisplayNewlines,
  type OutputRegionLayout,
} from "./output-layout";
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
const MAX_VISIBLE_PROCESS_DETAIL_LINES = 20;
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
    viewModel.currentError &&
    !isCodexExecInterruption(viewModel.currentError, viewModel.taskStatus)
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

  const regions = buildOutputRegionLayout(
    input.viewModel,
    MAX_VISIBLE_PROCESS_DETAIL_LINES,
  );

  if (regions.length === 0) {
    return h(
      Box,
      {
        marginTop: 1,
        flexDirection: "column",
      },
      h(
        Text,
        {
          color: THEME.text.dim,
        },
        "等待输入。",
      ),
    );
  }

  return h(
    Box,
    {
      marginTop: 1,
      flexDirection: "column",
    },
    ...regions.map((region, index) =>
      renderOutputRegion(region, {
        key: `${region.kind}_region`,
        marginTop: index === 0 ? 0 : 1,
        spinnerIndex,
      }),
    ),
  );
}

function renderOutputRegion(
  region: OutputRegionLayout,
  input: {
    key: string;
    marginTop: number;
    spinnerIndex: number;
  },
): unknown {
  switch (region.kind) {
    case "failure_main_screen":
      return h(FailureMainScreen, {
        key: input.key,
        error: region.error,
        marginTop: input.marginTop,
      });
    case "main_stream":
      return h(MainOutputStream, {
        key: input.key,
        entries: region.entries,
        title: region.title,
        marginTop: input.marginTop,
      });
    case "process":
      return h(ProcessRegion, {
        key: input.key,
        title: `${SPINNER_FRAMES[input.spinnerIndex]} 运行中`,
        summary: region.summary,
        lines: region.detailLines,
        hasOmittedLines: region.hasOmittedLines,
        marginTop: input.marginTop,
      });
  }
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

function MainOutputStream(input: {
  entries: MainOutputEntry[];
  title?: string;
  marginTop: number;
}): unknown {
  return h(
    Box,
    {
      marginTop: input.marginTop,
      flexDirection: "column",
    },
    input.title
      ? h(
          Text,
          {
            color: THEME.text.dim,
            bold: true,
          },
          input.title,
        )
      : null,
    ...input.entries.map((entry, index) =>
      h(MainOutputEntryBlock, {
        key: entry.block.id,
        entry,
        isLast: index === input.entries.length - 1,
      }),
    ),
  );
}

function FailureMainScreen(input: {
  error: NonNullable<CliViewModel["currentError"]>;
  marginTop: number;
}): unknown {
  const children = [
    h(
      Text,
      {
        key: "failure-title",
        color: THEME.error.title,
        bold: true,
      },
      "最终失败信息",
    ),
    h(
      Text,
      {
        key: "failure-summary",
        color: THEME.text.primary,
        bold: true,
      },
      input.error.summary,
    ),
    h(LabeledBlock, {
      key: "failure-reason",
      label: "[失败原因]",
      value: input.error.reason,
      color: THEME.error.body,
      bold: true,
    }),
  ];

  if (input.error.location) {
    children.push(
      h(LabeledBlock, {
        key: "failure-location",
        label: "[失败位置]",
        value: input.error.location,
        color: THEME.text.secondary,
      }),
    );
  }

  if (input.error.nextAction) {
    children.push(
      h(LabeledBlock, {
        key: "failure-next-action",
        label: "[下一步建议]",
        value: input.error.nextAction,
        color: THEME.chrome.appAccentSoft,
      }),
    );
  }

  return h(
    Box,
    {
      marginTop: input.marginTop,
      flexDirection: "column",
    },
    ...children,
  );
}

function MainOutputEntryBlock(input: {
  entry: MainOutputEntry;
  isLast: boolean;
}): unknown {
  if (input.entry.source === "skeleton") {
    return h(SkeletonStreamEntry, {
      block: input.entry.block,
      isLast: input.isLast,
    });
  }

  return h(FinalStreamEntry, {
    block: input.entry.block,
    isLast: input.isLast,
  });
}

function FinalStreamEntry(input: {
  block: UiBlock;
  isLast: boolean;
}): unknown {
  const toneStyle = resolveResultToneStyle(input.block.tone);
  const bodyLines = normalizeDisplayNewlines(input.block.body).split("\n");

  return h(
    Box,
    {
      marginBottom: input.isLast ? 0 : 1,
      flexDirection: "column",
    },
    input.block.title
      ? h(
          Text,
          {
            color: toneStyle.title,
            bold: input.block.tone !== "system",
          },
          input.block.title,
        )
      : null,
    ...bodyLines.map((line, index) =>
      h(
        Text,
        {
          key: `${input.block.id}_body_${String(index)}`,
          color: toneStyle.body,
          dimColor: false,
        },
        line,
      ),
    ),
  );
}

function SkeletonStreamEntry(input: {
  block: UiBlock;
  isLast: boolean;
}): unknown {
  const body = formatSkeletonBodyForDisplay(input.block.body);

  return h(
    Box,
    {
      marginBottom: input.isLast ? 0 : 1,
      flexDirection: "column",
    },
    input.block.title
      ? h(
          Text,
          {
            color: THEME.skeleton.event,
            bold: true,
          },
          input.block.title,
        )
      : null,
    body
      ? h(
          Text,
          {
            color: THEME.skeleton.detail,
          },
          body,
        )
      : null,
  );
}

function ProcessRegion(input: {
  title: string;
  summary: string;
  lines: string[];
  hasOmittedLines: boolean;
  marginTop: number;
}): unknown {
  return h(
    Box,
    {
      marginTop: input.marginTop,
      flexDirection: "column",
    },
    h(
      Text,
      {
        color: THEME.intermediate.title,
        bold: true,
      },
      input.title,
    ),
    h(
      Text,
      {
        color: THEME.intermediate.title,
      },
      input.summary,
    ),
    ...input.lines.map((line, index) =>
      h(
        Text,
        {
          key: `intermediate_line_${String(index)}`,
          color: THEME.intermediate.line,
          dimColor: true,
        },
        line,
      ),
    ),
    ...(input.hasOmittedLines
      ? [
          h(
            Text,
            {
              key: "intermediate_ellipsis",
              color: THEME.intermediate.empty,
            },
            "...",
          ),
        ]
      : []),
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

function formatSkeletonBodyForDisplay(body: string): string {
  return normalizeDisplayNewlines(body)
    .replace(/，(?=(当前|目标|工件|状态|阶段|角色|结果|原因|恢复点))/g, "，\n")
    .replace(/。(?=(当前|目标|工件|状态|阶段|角色|结果|原因|恢复点))/g, "。\n")
    .replace(
      /,(?=\s*(currentPhase|status|phaseStatus|resumeFrom|artifactPath|roleName|phase)\b)/g,
      ",\n",
    );
}

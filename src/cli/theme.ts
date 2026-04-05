import type { UiBlock } from "./ui-model";

export const THEME = {
  chrome: {
    appAccent: "#c24141",
    appAccentSoft: "#b45353",
    border: "#4c0519",
    borderMuted: "#3f2a2a",
    panel: "#1c1917",
  },
  text: {
    primary: "#f5f5f4",
    secondary: "#d6d3d1",
    muted: "#a8a29e",
    dim: "#78716c",
  },
  result: {
    title: "#dc2626",
    border: "#7f1d1d",
    highlight: "#fecaca",
    system: "#caa472",
    body: "#f5f5f4",
    separator: "#6b2a2a",
  },
  skeleton: {
    title: "#8b6b61",
    border: "#3f2a2a",
    event: "#a8a29e",
    detail: "#78716c",
  },
  intermediate: {
    title: "#78716c",
    border: "#2a2624",
    line: "#94a3b8",
    empty: "#6b7280",
  },
  input: {
    title: "#b45353",
    border: "#602020",
    hint: "#a8a29e",
    value: "#f5f5f4",
    idleCursor: "#dc2626",
    busyValue: "#78716c",
  },
  status: {
    ready: "#a8a29e",
    busy: "#dc2626",
    label: "#f5f5f4",
    separator: "#6b7280",
  },
  error: {
    title: "#f87171",
    border: "#7f1d1d",
    body: "#fecaca",
  },
} as const;

export interface ResultToneStyle {
  border: string;
  title: string;
  body: string;
  eyebrow: string;
}

export function resolveResultToneStyle(
  tone: UiBlock["tone"],
): ResultToneStyle {
  switch (tone) {
    case "result":
    case "accent":
      return {
        border: THEME.result.border,
        title: THEME.result.title,
        body: THEME.result.body,
        eyebrow: THEME.result.highlight,
      };
    case "system":
      return {
        border: THEME.chrome.borderMuted,
        title: THEME.result.system,
        body: THEME.text.secondary,
        eyebrow: THEME.result.system,
      };
    case "error":
      return {
        border: THEME.error.border,
        title: THEME.error.title,
        body: THEME.error.body,
        eyebrow: THEME.error.title,
      };
    default:
      return {
        border: THEME.chrome.borderMuted,
        title: THEME.result.highlight,
        body: THEME.result.body,
        eyebrow: THEME.result.highlight,
      };
  }
}

export function compactSkeletonBody(text: string): string {
  return text
    .replace(/\s*\n+\s*/g, " / ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

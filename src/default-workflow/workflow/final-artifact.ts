import type { Phase, RoleName } from "../shared/types";

export interface FinalArtifactDefinition {
  key: string;
  title: string;
  artifactIndex: number;
}

export interface FinalArtifactNormalizationInput {
  phase: Phase;
  roleName: RoleName;
  artifactKey: string;
  rawContent: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

const MAX_NORMALIZATION_DEPTH = 4;

export function resolveFinalArtifactDefinition(
  phase: Phase,
  roleName: RoleName,
): FinalArtifactDefinition {
  if (phase === "clarify") {
    return {
      key: "final-prd",
      title: "final-prd",
      artifactIndex: 0,
    };
  }

  return {
    key: createGenericArtifactKey(phase, roleName, 0),
    title: createGenericArtifactKey(phase, roleName, 0),
    artifactIndex: 0,
  };
}

export function createGenericArtifactKey(
  phase: Phase,
  roleName: RoleName,
  artifactIndex: number,
): string {
  return `${phase}-${roleName}-${artifactIndex + 1}`;
}

export function normalizeFinalArtifactMarkdown(
  input: FinalArtifactNormalizationInput,
): string {
  const normalized = normalizeArtifactContent(
    input.rawContent,
    {
      summary: input.summary,
      metadata: input.metadata,
    },
    0,
  );

  return `${normalized.trimEnd()}\n`;
}

function normalizeArtifactContent(
  rawContent: string,
  envelope: {
    summary?: string;
    metadata?: Record<string, unknown>;
  },
  depth: number,
): string {
  if (depth > MAX_NORMALIZATION_DEPTH) {
    throw new Error("Final artifact normalization exceeded the maximum nesting depth.");
  }

  const trimmed = rawContent.trim();

  if (trimmed.length === 0) {
    throw new Error("Final artifact content is empty.");
  }

  if (!looksLikeJsonPayload(trimmed)) {
    return appendReadableEnvelopeSections(trimmed, envelope.summary, envelope.metadata);
  }

  const parsed = parseJsonLikePayload(trimmed);

  if (isRoleResultEnvelope(parsed)) {
    const normalizedSummary = firstNonEmptyString(
      envelope.summary,
      typeof parsed.summary === "string" ? parsed.summary : undefined,
    );
    const normalizedMetadata = mergeMetadata(
      toRecord(parsed.metadata),
      envelope.metadata,
    );
    const artifactBody = extractFirstArtifact(parsed.artifacts);

    if (artifactBody) {
      return normalizeArtifactContent(
        artifactBody,
        {
          summary: normalizedSummary,
          metadata: normalizedMetadata,
        },
        depth + 1,
      );
    }

    const renderedEnvelopeOnly = renderReadableSectionsOnly(
      normalizedSummary,
      normalizedMetadata,
    );

    if (renderedEnvelopeOnly) {
      return renderedEnvelopeOnly;
    }

    throw new Error(
      "Final artifact RoleResult envelope does not contain a readable artifact body.",
    );
  }

  const markdownBody = renderStructuredMarkdown(parsed, 2);
  const finalized = appendReadableEnvelopeSections(
    markdownBody,
    envelope.summary,
    envelope.metadata,
  );

  if (finalized.trim().length === 0) {
    throw new Error("Final artifact JSON content could not be normalized into Markdown.");
  }

  return finalized;
}

function looksLikeJsonPayload(content: string): boolean {
  const trimmed = content.trim();

  if (/^```json\b/i.test(trimmed) && trimmed.endsWith("```")) {
    return true;
  }

  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function parseJsonLikePayload(content: string): unknown {
  const fencedMatch = content.match(/^```json\s*([\s\S]*?)\s*```$/i);
  const payloadText = fencedMatch?.[1]?.trim() ?? content.trim();

  try {
    return JSON.parse(payloadText) as unknown;
  } catch (error) {
    throw new Error(
      `Final artifact JSON normalization failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isRoleResultEnvelope(value: unknown): value is {
  summary?: unknown;
  artifacts?: unknown;
  artifactReady?: unknown;
  phaseCompleted?: unknown;
  metadata?: unknown;
} {
  if (!isRecord(value)) {
    return false;
  }

  return (
    "summary" in value ||
    "artifacts" in value ||
    "artifactReady" in value ||
    "phaseCompleted" in value ||
    "metadata" in value
  );
}

function appendReadableEnvelopeSections(
  body: string,
  summary?: string,
  metadata?: Record<string, unknown>,
): string {
  const sections = [body.trim()];
  const readableSections = buildReadableEnvelopeSections(body, summary, metadata);

  if (readableSections.length > 0) {
    sections.push(...readableSections);
  }

  return sections.filter((section) => section.trim().length > 0).join("\n\n");
}

function renderReadableSectionsOnly(
  summary?: string,
  metadata?: Record<string, unknown>,
): string {
  return buildReadableEnvelopeSections("", summary, metadata).join("\n\n");
}

function buildReadableEnvelopeSections(
  body: string,
  summary?: string,
  metadata?: Record<string, unknown>,
): string[] {
  const sections: string[] = [];
  const normalizedSummary = summary?.trim();

  if (
    normalizedSummary &&
    normalizedSummary.length > 0 &&
    !body.includes(normalizedSummary)
  ) {
    sections.push(["## 文档摘要", "", normalizedSummary].join("\n"));
  }

  if (!metadata) {
    return sections;
  }

  const blockingQuestions = asReadableList(metadata.blockingQuestions);

  if (blockingQuestions.length > 0) {
    sections.push(renderListSection("## Blocking Questions", blockingQuestions));
  }

  const openQuestions = asReadableList(metadata.openQuestions);

  if (openQuestions.length > 0) {
    sections.push(renderListSection("## Open Questions", openQuestions));
  }

  const notes = asReadableList(metadata.notes);

  if (notes.length > 0) {
    sections.push(renderListSection("## 补充说明", notes));
  }

  const conclusion = asReadableParagraphs([
    metadata.decision,
    metadata.conclusion,
    metadata.recommendation,
  ]);

  if (conclusion.length > 0) {
    sections.push(["## 结论", "", ...conclusion].join("\n"));
  }

  return sections;
}

function renderStructuredMarkdown(value: unknown, headingLevel: number): string {
  if (value === null || value === undefined) {
    return "无";
  }

  if (typeof value === "string") {
    return value.trim() || "无";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "- 无";
    }

    if (value.every(isPrimitiveValue)) {
      return value
        .map((item) => `- ${renderInlineValue(item)}`)
        .join("\n");
    }

    return value
      .map((item, index) => {
        if (isPrimitiveValue(item)) {
          return `- ${renderInlineValue(item)}`;
        }

        return [
          `${"#".repeat(Math.min(headingLevel, 6))} 条目 ${index + 1}`,
          "",
          renderStructuredMarkdown(item, headingLevel + 1),
        ].join("\n");
      })
      .join("\n\n");
  }

  if (!isRecord(value)) {
    return String(value);
  }

  const entries = Object.entries(value);

  if (entries.length === 0) {
    return "无";
  }

  if (entries.every(([, entryValue]) => isPrimitiveValue(entryValue))) {
    return entries
      .map(
        ([key, entryValue]) =>
          `- ${formatSectionLabel(key)}: ${renderInlineValue(entryValue)}`,
      )
      .join("\n");
  }

  return entries
    .map(([key, entryValue]) => [
      `${"#".repeat(Math.min(headingLevel, 6))} ${formatSectionLabel(key)}`,
      "",
      renderStructuredMarkdown(entryValue, headingLevel + 1),
    ].join("\n"))
    .join("\n\n");
}

function renderListSection(title: string, items: string[]): string {
  return [title, "", ...items.map((item) => `- ${item}`)].join("\n");
}

function asReadableList(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => renderInlineValue(item).trim())
    .filter((item) => item.length > 0);
}

function asReadableParagraphs(values: unknown[]): string[] {
  return values
    .map((value) => {
      if (typeof value !== "string") {
        return "";
      }

      return value.trim();
    })
    .filter((value) => value.length > 0);
}

function renderInlineValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "无";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => renderInlineValue(item))
      .filter((item) => item.length > 0)
      .join("; ");
  }

  if (!isRecord(value)) {
    return String(value);
  }

  return Object.entries(value)
    .map(([key, nestedValue]) => `${formatSectionLabel(key)}: ${renderInlineValue(nestedValue)}`)
    .join("; ");
}

function formatSectionLabel(key: string): string {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();

  if (normalized.length === 0) {
    return key;
  }

  return normalized.replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function extractFirstArtifact(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.find(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim().length);
}

function mergeMetadata(
  primary?: Record<string, unknown>,
  secondary?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!primary && !secondary) {
    return undefined;
  }

  return {
    ...(primary ?? {}),
    ...(secondary ?? {}),
  };
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPrimitiveValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

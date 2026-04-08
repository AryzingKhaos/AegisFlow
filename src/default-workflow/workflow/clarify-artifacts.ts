import type { InitialRequirementInputKind } from "../shared/types";

export function buildInitialRequirementArtifact(
  input: string,
  _kind: InitialRequirementInputKind,
): string {
  return input.trim();
}

export function buildInitialClarifyDialogueArtifact(): string {
  return ["# Clarify Dialogue", ""].join("\n");
}

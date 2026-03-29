import {
  DEFAULT_INTAKE_BASE_URL,
  DEFAULT_INTAKE_MODEL,
} from "../shared/constants";

export interface IntakeModelConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  sources: {
    model: string;
    baseUrl: string;
    apiKey: string;
  };
}

export function resolveIntakeModelConfig(
  env: Record<string, string | undefined> = process.env,
): IntakeModelConfig {
  const model =
    env.AEGISFLOW_INTAKE_MODEL ?? env.OPENAI_MODEL ?? DEFAULT_INTAKE_MODEL;
  const baseUrl =
    env.AEGISFLOW_INTAKE_BASE_URL ??
    env.OPENAI_BASE_URL ??
    DEFAULT_INTAKE_BASE_URL;
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required before starting the Intake CLI.",
    );
  }

  return {
    model,
    baseUrl,
    apiKey,
    sources: {
      model: env.AEGISFLOW_INTAKE_MODEL
        ? "AEGISFLOW_INTAKE_MODEL"
        : env.OPENAI_MODEL
          ? "OPENAI_MODEL"
          : "default",
      baseUrl: env.AEGISFLOW_INTAKE_BASE_URL
        ? "AEGISFLOW_INTAKE_BASE_URL"
        : env.OPENAI_BASE_URL
          ? "OPENAI_BASE_URL"
          : "default",
      apiKey: "OPENAI_API_KEY",
    },
  };
}

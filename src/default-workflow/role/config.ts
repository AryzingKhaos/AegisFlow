import {
  DEFAULT_ROLE_BASE_URL,
  DEFAULT_ROLE_MODEL,
} from "../shared/constants";

export interface RoleModelConfig {
  model: string;
  baseUrl: string;
  apiKey: string;
  executionMode: "agent" | "stub";
  sources: {
    model: string;
    baseUrl: string;
    apiKey: string;
    executionMode: string;
  };
}

export function resolveRoleModelConfig(
  env: Record<string, string | undefined> = process.env,
): RoleModelConfig {
  // 角色层允许单独覆盖模型配置；未显式配置时回退到通用 OPENAI_* 变量。
  const model =
    env.AEGISFLOW_ROLE_MODEL ?? env.OPENAI_MODEL ?? DEFAULT_ROLE_MODEL;
  const baseUrl =
    env.AEGISFLOW_ROLE_BASE_URL ??
    env.OPENAI_BASE_URL ??
    DEFAULT_ROLE_BASE_URL;
  // 本期仍统一使用 OPENAI_API_KEY 作为鉴权入口，
  // 避免角色层再引入一套独立密钥命名导致启动配置分叉。
  const apiKey = env.OPENAI_API_KEY?.trim();
  const executionMode =
    env.AEGISFLOW_ROLE_EXECUTION_MODE === "stub" ? "stub" : "agent";

  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required before creating default workflow roles.",
    );
  }

  return {
    model,
    baseUrl,
    apiKey,
    executionMode,
    sources: {
      model: env.AEGISFLOW_ROLE_MODEL
        ? "AEGISFLOW_ROLE_MODEL"
        : env.OPENAI_MODEL
          ? "OPENAI_MODEL"
          : "default",
      baseUrl: env.AEGISFLOW_ROLE_BASE_URL
        ? "AEGISFLOW_ROLE_BASE_URL"
        : env.OPENAI_BASE_URL
          ? "OPENAI_BASE_URL"
          : "default",
      apiKey: "OPENAI_API_KEY",
      executionMode: env.AEGISFLOW_ROLE_EXECUTION_MODE
        ? "AEGISFLOW_ROLE_EXECUTION_MODE"
        : "default",
    },
  };
}

import {
  DEFAULT_ROLE_CODEX_BASE_URL,
  DEFAULT_ROLE_CODEX_MODEL,
} from "../shared/constants";

export interface RoleCodexConfig {
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

export function resolveRoleCodexConfig(
  env: Record<string, string | undefined> = process.env,
): RoleCodexConfig {
  // 角色层正式配置入口收敛到 Codex 专用变量，
  // 避免继续沿用通用 role model 命名导致角色执行配置分叉。
  const model = env.AEGISFLOW_ROLE_CODEX_MODEL ?? DEFAULT_ROLE_CODEX_MODEL;
  const baseUrl =
    env.AEGISFLOW_ROLE_CODEX_BASE_URL ?? DEFAULT_ROLE_CODEX_BASE_URL;
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
      model: env.AEGISFLOW_ROLE_CODEX_MODEL
        ? "AEGISFLOW_ROLE_CODEX_MODEL"
        : "default",
      baseUrl: env.AEGISFLOW_ROLE_CODEX_BASE_URL
        ? "AEGISFLOW_ROLE_CODEX_BASE_URL"
        : "default",
      apiKey: "OPENAI_API_KEY",
      executionMode: env.AEGISFLOW_ROLE_EXECUTION_MODE
        ? "AEGISFLOW_ROLE_EXECUTION_MODE"
        : "default",
    },
  };
}

export function resolveRoleModelConfig(
  env: Record<string, string | undefined> = process.env,
): RoleCodexConfig {
  // 兼容旧调用点，内部已统一转到 Codex 专用配置解析。
  return resolveRoleCodexConfig(env);
}

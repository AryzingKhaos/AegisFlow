import { ChatOpenAI } from "@langchain/openai";
import { resolveIntakeModelConfig } from "./config";

export interface IntakeModelBootstrap {
  llm: ChatOpenAI;
  prompt: string;
  config: ReturnType<typeof resolveIntakeModelConfig>;
}

export function buildIntakePrompt(): string {
  return [
    "You are the IntakeAgent for AegisFlow.",
    "You only handle CLI intake, light workflow selection, runtime preparation, and event forwarding.",
    "You must not orchestrate workflow phases or impersonate downstream roles.",
    "For requests outside v0.1 scope, respond with the exact Chinese string: 敬请期待",
  ].join(" ");
}

export function initializeIntakeModel(): IntakeModelBootstrap {
  const config = resolveIntakeModelConfig();
  const prompt = buildIntakePrompt();
  const llm = new ChatOpenAI({
    model: config.model,
    apiKey: config.apiKey,
    temperature: 0,
    configuration: {
      baseURL: config.baseUrl,
    },
  });

  return {
    llm,
    prompt,
    config,
  };
}


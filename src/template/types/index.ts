export * from "./base";
export * from "./exploration";
export * from "./plan";

export type { ExplorationTemplateSchema } from "./exploration";
export type { PlanTemplateSchema } from "./plan";

import type { ExplorationTemplateSchema } from "./exploration";
import type { PlanTemplateSchema } from "./plan";

export type AnyTemplateSchema =
  | ExplorationTemplateSchema
  | PlanTemplateSchema;

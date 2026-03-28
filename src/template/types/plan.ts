import type { TemplateSchema } from "./base";

export type PlanTemplateType = "featureSpec" | "implementationPlan";

export type PlanCommonSectionKey = "summary";

export type FeatureSpecSectionKey =
  | PlanCommonSectionKey
  | "background"
  | "featureGoals"
  | "nonGoals"
  | "currentBehavior"
  | "targetBehavior"
  | "flowDescription"
  | "flowchart";

export type ImplementationPlanSectionKey =
  | PlanCommonSectionKey
  | "inputBasis"
  | "implementationGoals"
  | "implementationStrategy"
  | "implementationFlowchart"
  | "todoList";

export type FeatureSpecSchema = TemplateSchema<
  "featureSpec",
  FeatureSpecSectionKey
>;

export type ImplementationPlanSchema = TemplateSchema<
  "implementationPlan",
  ImplementationPlanSectionKey
>;

export type PlanTemplateSchema = FeatureSpecSchema | ImplementationPlanSchema;

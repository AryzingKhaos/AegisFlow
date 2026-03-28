import { TemplateBase } from "./base";
import type {
  FeatureSpecSectionKey,
  ImplementationPlanSectionKey,
  PlanTemplateType,
} from "../types";

export abstract class PlanBase<
  TTemplateType extends PlanTemplateType,
  TSectionKey extends string,
> extends TemplateBase<TTemplateType, TSectionKey> {
  readonly category = "plan" as const;

  readonly commonSectionKeys = ["summary"] as const;
}

export class FeatureSpecTemplate extends PlanBase<
  "featureSpec",
  FeatureSpecSectionKey
> {}

export class ImplementationPlanTemplate extends PlanBase<
  "implementationPlan",
  ImplementationPlanSectionKey
> {}

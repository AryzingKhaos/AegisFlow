import { TemplateBase } from "./base";
import type {
  BugFixExplorationSectionKey,
  ExplorationTemplateType,
  FeatureChangeExplorationSectionKey,
  ImpactAnalysisExplorationSectionKey,
  NewFeatureExplorationSectionKey,
  UnfamiliarProjectArchitectureExplorationSectionKey,
} from "../types";

export abstract class ExplorationBase<
  TTemplateType extends ExplorationTemplateType,
  TSectionKey extends string,
> extends TemplateBase<TTemplateType, TSectionKey> {
  readonly category = "exploration" as const;

  readonly commonSectionKeys = [
    "summary",
    "openQuestions",
    "currentExplorationConclusion",
  ] as const;
}

export class BugFixExplorationTemplate extends ExplorationBase<
  "explorationBugFix",
  BugFixExplorationSectionKey
> {}

export class FeatureChangeExplorationTemplate extends ExplorationBase<
  "explorationFeatureChange",
  FeatureChangeExplorationSectionKey
> {}

export class ImpactAnalysisExplorationTemplate extends ExplorationBase<
  "explorationImpactAnalysisForUnfamiliarProject",
  ImpactAnalysisExplorationSectionKey
> {}

export class NewFeatureExplorationTemplate extends ExplorationBase<
  "explorationNewFeature",
  NewFeatureExplorationSectionKey
> {}

export class UnfamiliarProjectArchitectureExplorationTemplate extends ExplorationBase<
  "explorationUnfamiliarProjectArchitecture",
  UnfamiliarProjectArchitectureExplorationSectionKey
> {}

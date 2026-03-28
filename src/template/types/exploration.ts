import type { TemplateSchema } from "./base";

export type ExplorationTemplateType =
  | "explorationBugFix"
  | "explorationFeatureChange"
  | "explorationImpactAnalysisForUnfamiliarProject"
  | "explorationNewFeature"
  | "explorationUnfamiliarProjectArchitecture";

export type ExplorationCommonSectionKey =
  | "summary"
  | "openQuestions"
  | "currentExplorationConclusion";

export type BugFixExplorationSectionKey =
  | ExplorationCommonSectionKey
  | "problemDescription"
  | "reproductionPath"
  | "relatedEntryPoints"
  | "keyLogicFlow"
  | "relatedModules"
  | "possibleRootCauses"
  | "impactScope"
  | "risks";

export type FeatureChangeExplorationSectionKey =
  | ExplorationCommonSectionKey
  | "requirementSummary"
  | "currentBehavior"
  | "changeGoals"
  | "entryPoints"
  | "keyLogicFlow"
  | "relatedModules"
  | "stateAndDependencyAnalysis"
  | "impactScope"
  | "currentLogicConstraints"
  | "potentialRisks";

export type ImpactAnalysisExplorationSectionKey =
  | ExplorationCommonSectionKey
  | "targetChanges"
  | "entryPoints"
  | "keyCallChains"
  | "dependencies"
  | "currentLogicSpecialReasons"
  | "impactAnalysis"
  | "currentConfidenceGaps"
  | "preSubmissionChecks";

export type NewFeatureExplorationSectionKey =
  | ExplorationCommonSectionKey
  | "requirementSummary"
  | "reusableCapabilities"
  | "possibleEntryPoints"
  | "relatedModules"
  | "dataAndStateDependencies"
  | "externalReferences"
  | "potentialRisks";

export type UnfamiliarProjectArchitectureExplorationSectionKey =
  | ExplorationCommonSectionKey
  | "projectGoalsAndCoreCapabilities"
  | "directoryStructureOverview"
  | "architectureLayers"
  | "mainEntryPoints"
  | "coreModules"
  | "stateAndDataFlow"
  | "moduleRelationships"
  | "specialArchitecturePoints"
  | "highRiskAreas"
  | "recommendedReadingPath";

export type BugFixExplorationSchema = TemplateSchema<
  "explorationBugFix",
  BugFixExplorationSectionKey
>;

export type FeatureChangeExplorationSchema = TemplateSchema<
  "explorationFeatureChange",
  FeatureChangeExplorationSectionKey
>;

export type ImpactAnalysisExplorationSchema = TemplateSchema<
  "explorationImpactAnalysisForUnfamiliarProject",
  ImpactAnalysisExplorationSectionKey
>;

export type NewFeatureExplorationSchema = TemplateSchema<
  "explorationNewFeature",
  NewFeatureExplorationSectionKey
>;

export type UnfamiliarProjectArchitectureExplorationSchema = TemplateSchema<
  "explorationUnfamiliarProjectArchitecture",
  UnfamiliarProjectArchitectureExplorationSectionKey
>;

export type ExplorationTemplateSchema =
  | BugFixExplorationSchema
  | FeatureChangeExplorationSchema
  | ImpactAnalysisExplorationSchema
  | NewFeatureExplorationSchema
  | UnfamiliarProjectArchitectureExplorationSchema;

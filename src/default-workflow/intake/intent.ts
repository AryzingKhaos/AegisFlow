import {
  CANCEL_HINT_PATTERNS,
  OUT_OF_SCOPE_PATTERNS,
  OUT_OF_SCOPE_DIRECTIVE_PATTERNS,
  OUT_OF_SCOPE_PHASE_PATTERNS,
  OUT_OF_SCOPE_ROLE_PATTERNS,
  RESUME_HINT_PATTERNS,
  SUPPORTED_WORKFLOW_TYPES,
} from "../shared/constants";
import type { WorkflowTaskType } from "../shared/types";

export type NormalizedIntentType =
  | "new_task"
  | "participate"
  | "resume_task"
  | "cancel_task"
  | "out_of_scope";

export interface NormalizedIntent {
  type: NormalizedIntentType;
  taskType?: WorkflowTaskType;
  confidence: "high" | "medium" | "low";
  normalizedMessage: string;
}

const BUGFIX_PATTERNS = [
  /bug/i,
  /修复/,
  /报错/,
  /异常/,
  /错误/,
  /crash/i,
  /故障/,
  /问题/,
];

const SMALL_NEW_FEATURE_PATTERNS = [
  /新增/,
  /添加/,
  /新功能/,
  /支持/,
  /接入/,
  /enable/i,
  /implement/i,
];

const FEATURE_CHANGE_PATTERNS = [
  /修改/,
  /调整/,
  /优化/,
  /适配/,
  /改造/,
  /update/i,
  /change/i,
];

export function inferWorkflowTaskType(
  input: string,
): { taskType: WorkflowTaskType; confidence: "high" | "medium" | "low" } {
  const bugfixScore = scorePatterns(input, BUGFIX_PATTERNS);
  const newFeatureScore = scorePatterns(input, SMALL_NEW_FEATURE_PATTERNS);
  const featureChangeScore = scorePatterns(input, FEATURE_CHANGE_PATTERNS);
  const entries: Array<{
    taskType: WorkflowTaskType;
    score: number;
  }> = [
    { taskType: "bugfix", score: bugfixScore },
    { taskType: "small_new_feature", score: newFeatureScore },
    { taskType: "feature_change", score: featureChangeScore },
  ];
  entries.sort((left, right) => right.score - left.score);

  const best = entries[0];

  if (best.score >= 2) {
    return { taskType: best.taskType, confidence: "high" };
  }

  if (best.score === 1) {
    return { taskType: best.taskType, confidence: "medium" };
  }

  return { taskType: "feature_change", confidence: "low" };
}

export function normalizeUserIntent(
  input: string,
  hasActiveTask: boolean,
): NormalizedIntent {
  const normalizedMessage = input.trim();

  if (isOutOfScopeRequest(normalizedMessage, hasActiveTask)) {
    return {
      type: "out_of_scope",
      confidence: "high",
      normalizedMessage,
    };
  }

  if (CANCEL_HINT_PATTERNS.some((pattern) => pattern.test(normalizedMessage))) {
    return {
      type: "cancel_task",
      confidence: "high",
      normalizedMessage,
    };
  }

  if (RESUME_HINT_PATTERNS.some((pattern) => pattern.test(normalizedMessage))) {
    return {
      type: "resume_task",
      confidence: "high",
      normalizedMessage,
    };
  }

  if (hasActiveTask) {
    return {
      type: "participate",
      confidence: "medium",
      normalizedMessage,
    };
  }

  const workflowGuess = inferWorkflowTaskType(normalizedMessage);

  return {
    type: "new_task",
    taskType: workflowGuess.taskType,
    confidence: workflowGuess.confidence,
    normalizedMessage,
  };
}

export function describeWorkflowGuess(taskType: WorkflowTaskType): string {
  const definition = SUPPORTED_WORKFLOW_TYPES[taskType];
  return `${definition.label}：${definition.description}`;
}

export function isOutOfScopeRequest(
  input: string,
  hasActiveTask: boolean,
): boolean {
  if (OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(input))) {
    return true;
  }

  const hasRoleReference = OUT_OF_SCOPE_ROLE_PATTERNS.some((pattern) =>
    pattern.test(input),
  );
  const hasPhaseReference = OUT_OF_SCOPE_PHASE_PATTERNS.some((pattern) =>
    pattern.test(input),
  );
  const hasDirective = OUT_OF_SCOPE_DIRECTIVE_PATTERNS.some((pattern) =>
    pattern.test(input),
  );

  if ((hasRoleReference || hasPhaseReference) && hasDirective) {
    return true;
  }

  if (
    hasActiveTask &&
    (/(进入|切到|切换到).*(clarify|explore|plan|build|review|test-design|unit-test|test)/i.test(input) ||
      /(进入|切到|切换到).*(澄清|探索|规划|实现|评审|测试设计|单元测试|测试)/.test(input))
  ) {
    return true;
  }

  return false;
}

function scorePatterns(input: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => {
    return score + (pattern.test(input) ? 1 : 0);
  }, 0);
}

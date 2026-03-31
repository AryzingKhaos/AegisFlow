import type {
  Phase,
  RoleName,
  WorkflowPhaseConfig,
  WorkflowTaskType,
} from "./types";

export const DEFAULT_INTAKE_MODEL = "gpt5.4";
export const DEFAULT_INTAKE_BASE_URL = "https://co.yes.vg/v1";
// PRD 对外表述为“codex 5.4”，代码里使用可执行的模型标识。
export const DEFAULT_ROLE_CODEX_MODEL = "codex-5.4";
export const DEFAULT_ROLE_CODEX_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_ROLE_EXECUTOR_COMMAND = "codex";
export const DEFAULT_ROLE_EXECUTOR_TIMEOUT_MS = 300000;
export const DEFAULT_WORKFLOW_ID = "default-workflow";
export const DEFAULT_ARTIFACT_DIR_NAME = ".aegisflow/artifacts";
export const DEFAULT_ROLE_PROMPT_DIR_NAME = ".aegisflow/roles";
export const INTAKE_STATE_DIR_NAME = ".aegisflow";
export const INTAKE_RESUME_INDEX_FILE = "latest-task.json";
export const DEFAULT_WORKFLOW_PROFILE_ID = "default-v0.1";
export const DEFAULT_WORKFLOW_PROFILE_LABEL = "default-workflow/v0.1";

export const SUPPORTED_WORKFLOW_TYPES: Record<
  WorkflowTaskType,
  {
    label: string;
    description: string;
  }
> = {
  feature_change: {
    label: "Feature Change",
    description: "已有功能点的规则修改、页面适配或联动逻辑调整。",
  },
  bugfix: {
    label: "Bugfix",
    description: "已有问题修复、边界情况修复或回归问题修复。",
  },
  small_new_feature: {
    label: "Small New Feature",
    description: "较小范围的新功能点开发。",
  },
};

export const OUT_OF_SCOPE_REPLY = "敬请期待";

export const RESUME_HINT_PATTERNS = [
  /继续执行/,
  /继续完成/,
  /继续跑/,
  /恢复任务/,
  /继续任务/,
  /\bresume\b/i,
  /\bcontinue\b/i,
  /^继续$/,
];

export const CANCEL_HINT_PATTERNS = [
  /取消任务/,
  /结束任务/,
  /停止任务/,
  /不做了/,
  /\bcancel\b/i,
];

export const OUT_OF_SCOPE_PATTERNS = [
  /archive/i,
  /archivist/i,
  /architect/i,
  /图形界面/,
  /web ui/i,
  /后台管理/,
  /多工作流市场/,
  /帮我编排/i,
];

export const OUT_OF_SCOPE_ROLE_PATTERNS = [
  /\bclarifier\b/i,
  /\bexplorer\b/i,
  /\bplanner\b/i,
  /\bbuilder\b/i,
  /\bcritic\b/i,
  /\btest designer\b/i,
  /\btest writer\b/i,
  /\btester\b/i,
  /澄清角色/,
  /探索角色/,
  /规划角色/,
  /实现角色/,
  /评审角色/,
  /测试设计角色/,
  /测试编写角色/,
  /测试执行角色/,
];

export const OUT_OF_SCOPE_PHASE_PATTERNS = [
  /\bclarify\b/i,
  /\bexplore\b/i,
  /\bplan\b/i,
  /\bbuild\b/i,
  /\breview\b/i,
  /\btest-design\b/i,
  /\bunit-test\b/i,
  /\btest\b/i,
  /澄清阶段/,
  /探索阶段/,
  /规划阶段/,
  /实现阶段/,
  /评审阶段/,
  /测试设计阶段/,
  /单元测试阶段/,
  /测试阶段/,
];

export const OUT_OF_SCOPE_DIRECTIVE_PATTERNS = [
  /跳过/,
  /直接进入/,
  /直接到/,
  /切换到/,
  /切到/,
  /只做/,
  /不要经过/,
  /不经过/,
  /绕过/,
  /略过/,
  /你来当/,
  /扮演/,
  /作为.*角色/,
  /输出.*工件/,
  /生成.*工件/,
];

export const DEFAULT_WORKFLOW_PHASES: WorkflowPhaseConfig[] = [
  { name: "clarify", hostRole: "clarifier", needApproval: false },
  { name: "explore", hostRole: "explorer", needApproval: false },
  { name: "plan", hostRole: "planner", needApproval: true },
  { name: "build", hostRole: "builder", needApproval: false },
  { name: "review", hostRole: "critic", needApproval: true },
  { name: "test-design", hostRole: "test-designer", needApproval: false },
  { name: "unit-test", hostRole: "test-writer", needApproval: false },
  { name: "test", hostRole: "tester", needApproval: false },
];

export const DEFAULT_PHASE_ROLE_MAPPING: Record<Phase, RoleName> = {
  clarify: "clarifier",
  explore: "explorer",
  plan: "planner",
  build: "builder",
  review: "critic",
  "test-design": "test-designer",
  "unit-test": "test-writer",
  test: "tester",
};

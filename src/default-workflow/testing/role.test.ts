import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileArtifactManager } from "../persistence/task-store";
import { buildRolePrompt } from "../role/prompts";
import { executeRoleAgent, type RoleAgentBootstrap } from "../role/model";
import {
  DefaultRoleRegistry,
  createDefaultRoleDefinitions,
} from "../runtime/dependencies";
import {
  createInitialTaskState,
  createProjectConfig,
  createWorkflowSelection,
} from "../shared/utils";
import type {
  EventLogger,
  Role,
  RoleCapabilityProfile,
  RoleName,
  RoleRegistry,
  WorkflowEvent,
  WorkflowPhaseConfig,
} from "../shared/types";
import { TaskStatus } from "../shared/types";
import { DefaultWorkflowController } from "../workflow/controller";

const tempDirs: string[] = [];

beforeEach(() => {
  process.env.OPENAI_API_KEY = "dummy";
  process.env.AEGISFLOW_ROLE_EXECUTION_MODE = "stub";
});

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("role layer", () => {
  it("lazily creates and caches role instances with limited RoleRuntime", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: [
        {
          name: "build",
          hostRole: "builder",
          needApproval: false,
        },
      ],
    });
    const registry = new DefaultRoleRegistry({
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
    });

    let createCount = 0;
    let observedRuntime: Record<string, unknown> | null = null;

    registry.register({
      name: "builder",
      description: "builder test role",
      create(roleRuntime) {
        createCount += 1;
        observedRuntime = roleRuntime as unknown as Record<string, unknown>;

        return createRole("builder", async () => ({
          summary: "builder done",
          artifacts: [],
        }));
      },
    });

    const first = registry.get("builder");
    const second = registry.get("builder");

    expect(first).toBe(second);
    expect(createCount).toBe(1);
    expect(observedRuntime?.projectConfig).toBe(projectConfig);
    expect(observedRuntime?.roleRegistry).toBe(registry);
    expect(observedRuntime?.roleCapabilityProfiles).toBeDefined();
    expect("taskState" in (observedRuntime ?? {})).toBe(false);
    expect("workflow" in (observedRuntime ?? {})).toBe(false);
    expect("artifactManager" in (observedRuntime ?? {})).toBe(false);
  });

  it("registers the full v0.1 default role definition set", () => {
    const roleNames = createDefaultRoleDefinitions().map((roleDef) => roleDef.name);

    expect(roleNames.sort()).toEqual(
      [
        "builder",
        "clarifier",
        "critic",
        "explorer",
        "planner",
        "test-designer",
        "test-writer",
        "tester",
      ].sort(),
    );
  });

  it("builds critic prompts from builtin docs, project common constraints, and default critic file", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    const promptDir = path.join(projectDir, ".aegisflow", "roles");
    await mkdir(promptDir, { recursive: true });
    await writeFile(
      path.join(promptDir, "common.md"),
      "PROJECT_COMMON_PROMPT",
      "utf8",
    );
    await writeFile(
      path.join(promptDir, "critic.md"),
      "DEFAULT_PROJECT_CRITIC_PROMPT",
      "utf8",
    );

    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("feature_change"),
      targetProjectRolePromptPath: ".aegisflow/roles",
    });
    const originalCwd = process.cwd();

    try {
      process.chdir(projectDir);

      const promptBundle = await buildRolePrompt("critic", projectConfig);

      expect(
        promptBundle.promptSources.some((source) =>
          source.endsWith("/roleflow/roles/frontend-critic.md"),
        ),
      ).toBe(true);
      expect(
        promptBundle.promptSources.some((source) =>
          source.endsWith(".aegisflow/roles/common.md"),
        ),
      ).toBe(true);
      expect(
        promptBundle.promptSources.some((source) =>
          source.endsWith(".aegisflow/roles/critic.md"),
        ),
      ).toBe(true);
      expect(promptBundle.prompt).toContain("PROJECT_COMMON_PROMPT");
      expect(promptBundle.prompt).toContain("DEFAULT_PROJECT_CRITIC_PROMPT");
      expect(
        promptBundle.promptWarnings.some((warning) =>
          warning.includes("frontend-critic.md"),
        ),
      ).toBe(false);
      expect(
        promptBundle.promptWarnings.some((warning) =>
          warning.includes(".aegisflow/roles/common.md"),
        ),
      ).toBe(false);
      expect(
        promptBundle.promptWarnings.some((warning) =>
          warning.includes(".aegisflow/roles/critic.md"),
        ),
      ).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("prefers critic override files over the default same-name project prompt", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    const promptDir = path.join(projectDir, ".aegisflow", "roles");
    const overrideDir = path.join(projectDir, "custom-prompts");
    await mkdir(promptDir, { recursive: true });
    await mkdir(overrideDir, { recursive: true });
    await writeFile(path.join(promptDir, "common.md"), "PROJECT_COMMON_PROMPT", "utf8");
    await writeFile(path.join(promptDir, "critic.md"), "DEFAULT_PROJECT_CRITIC_PROMPT", "utf8");
    await writeFile(
      path.join(overrideDir, "critic-override.md"),
      "OVERRIDE_PROJECT_CRITIC_PROMPT",
      "utf8",
    );

    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("feature_change"),
      targetProjectRolePromptPath: ".aegisflow/roles",
      rolePromptOverrides: {
        critic: "custom-prompts/critic-override.md",
      },
    });

    const promptBundle = await buildRolePrompt("critic", projectConfig);

    expect(
      promptBundle.promptSources.some((source) =>
        source.endsWith(".aegisflow/roles/common.md"),
      ),
    ).toBe(true);
    expect(
      promptBundle.promptSources.some((source) =>
        source.endsWith("custom-prompts/critic-override.md"),
      ),
    ).toBe(true);
    expect(promptBundle.prompt).toContain("OVERRIDE_PROJECT_CRITIC_PROMPT");
    expect(promptBundle.prompt).not.toContain("DEFAULT_PROJECT_CRITIC_PROMPT");
  });

  it("keeps project prompt config and critic filenames aligned", async () => {
    const configContent = await readFile(
      path.resolve(process.cwd(), ".aegisflow/aegisproject.yaml"),
      "utf8",
    );
    const projectRoleIndex = await readFile(
      path.resolve(process.cwd(), ".aegisflow/roles/index.md"),
      "utf8",
    );
    const sourceRoleIndex = await readFile(
      path.resolve(process.cwd(), "roleflow/context/roles/index.md"),
      "utf8",
    );

    expect(configContent).toContain('promptDir: ".aegisflow/roles"');
    expect(configContent).not.toContain("frontend-critic.md");
    expect(projectRoleIndex).toContain("[critic.md](critic.md)");
    expect(projectRoleIndex).not.toContain("[frontend-critic.md](frontend-critic.md)");
    expect(sourceRoleIndex).toContain("[critic.md](critic.md)");
    expect(sourceRoleIndex).not.toContain("[frontend-critic.md]");
  });

  it("executes role output through the agent pipeline instead of local placeholder text", async () => {
    const projectConfig = createProjectConfig({
      projectDir: "/tmp/project",
      artifactDir: "/tmp/project/.aegisflow/artifacts",
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases: [
        {
          name: "plan",
          hostRole: "planner",
          needApproval: false,
        },
      ],
    });
    const fakeBootstrap: RoleAgentBootstrap = {
      llm: {
        invoke: async (prompt: string) => ({
          content: JSON.stringify({
            summary: prompt.includes("design_plan")
              ? "planner 已通过 agent 输出计划"
              : "unexpected",
            artifacts: ["# plan artifact\n\nfrom-agent"],
            metadata: {
              source: "fake-llm",
            },
          }),
        }),
      } as unknown as RoleAgentBootstrap["llm"],
      prompt: "SYSTEM_PROMPT",
      promptSources: ["builtin/planner.md"],
      promptWarnings: [],
      config: {
        model: "fake-model",
        baseUrl: "http://localhost",
        apiKey: "dummy",
        executionMode: "agent",
        sources: {
          model: "default",
          baseUrl: "default",
          apiKey: "OPENAI_API_KEY",
          executionMode: "default",
        },
      },
    };
    const executionProfile: RoleCapabilityProfile = {
      mode: "analysis",
      sideEffects: "forbidden",
      allowedActions: ["design_plan"],
      focus: "形成可执行计划",
    };

    const result = await executeRoleAgent({
      bootstrap: fakeBootstrap,
      roleName: "planner",
      executionProfile,
      context: {
        taskId: "task_agent_execution_case",
        phase: "plan",
        cwd: "/tmp/project",
        projectConfig,
        roleCapabilityProfile: executionProfile,
        artifacts: {
          async get() {
            return undefined;
          },
          async list() {
            return [];
          },
        },
      },
      input: "为登录异常修复制定计划",
    });

    expect(result.summary).toBe("planner 已通过 agent 输出计划");
    expect(result.artifacts).toEqual(["# plan artifact\n\nfrom-agent"]);
    expect(result.metadata?.source).toBe("fake-llm");
    expect(result.metadata?.executionMode).toBe("agent");
  });

  it("passes read-only ExecutionContext into roles and persists string artifacts", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const workflowPhases: WorkflowPhaseConfig[] = [
      {
        name: "clarify",
        hostRole: "clarifier",
        needApproval: false,
      },
    ];
    const projectConfig = createProjectConfig({
      projectDir,
      artifactDir,
      workflow: createWorkflowSelection("bugfix"),
      workflowPhases,
    });
    const artifactManager = new FileArtifactManager(projectConfig);
    const taskState = createInitialTaskState(
      "task_role_boundary_case",
      "role_boundary_case",
      workflowPhases,
    );
    await artifactManager.initializeTask(taskState.taskId);
    await artifactManager.saveTaskContext({
      taskId: taskState.taskId,
      title: taskState.title,
      description: "角色边界测试",
      createdAt: Date.now(),
      lastRuntimeId: "runtime_role_boundary_case",
      projectConfig,
    });

    let observedContext: Record<string, unknown> | null = null;
    const controller = new DefaultWorkflowController({
      taskState,
      projectConfig,
      eventEmitter: new EventEmitter(),
      eventLogger: new MemoryEventLogger(),
      artifactManager,
      roleRegistry: new InlineRoleRegistry({
        clarifier: createRole("clarifier", async (_input, context) => {
          observedContext = context as unknown as Record<string, unknown>;
          expect(await context.artifacts.list()).toEqual([]);
          expect(context.roleCapabilityProfile.sideEffects).toBe("forbidden");

          return {
            summary: "clarifier done",
            artifacts: ["# clarify artifact\n\ncontent"],
          };
        }),
      }),
    });

    await controller.run(taskState.taskId, "角色边界测试");

    expect(taskState.status).toBe(TaskStatus.COMPLETED);
    expect("taskState" in (observedContext ?? {})).toBe(false);
    expect("latestInput" in (observedContext ?? {})).toBe(false);
    expect(
      "saveArtifact" in
        (((observedContext?.artifacts as Record<string, unknown> | undefined) ?? {})),
    ).toBe(false);

    const artifactPath = path.join(
      artifactDir,
      "tasks",
      taskState.taskId,
      "artifacts",
      "clarify",
      "clarify-clarifier-1.md",
    );
    const artifactContent = await readFile(artifactPath, "utf8");
    expect(artifactContent).toBe("# clarify artifact\n\ncontent");
  });
});

class MemoryEventLogger implements EventLogger {
  public readonly events: WorkflowEvent[] = [];

  public async append(event: WorkflowEvent): Promise<void> {
    this.events.push(event);
  }
}

class InlineRoleRegistry implements RoleRegistry {
  private readonly roles: Map<RoleName, Role>;

  public constructor(partialRoles: Partial<Record<RoleName, Role>>) {
    this.roles = new Map(
      Object.entries(partialRoles).map(([name, role]) => [name as RoleName, role as Role]),
    );
  }

  public register(): void {
    throw new Error("InlineRoleRegistry.register is not implemented for this test");
  }

  public get(name: RoleName): Role {
    const role = this.roles.get(name);

    if (!role) {
      throw new Error(`Role not registered in test registry: ${name}`);
    }

    return role;
  }

  public list(): string[] {
    return [...this.roles.keys()];
  }
}

function createRole(
  name: RoleName,
  run: Role["run"],
): Role {
  return {
    name,
    description: name,
    placeholder: false,
    capabilityProfile: createCapabilityProfile(name),
    run,
  };
}

function createCapabilityProfile(name: RoleName): RoleCapabilityProfile {
  return {
    mode:
      name === "builder" || name === "test-writer"
        ? "delivery"
        : name === "tester" || name === "test-designer"
          ? "verification"
          : "analysis",
    sideEffects:
      name === "builder" ||
      name === "tester" ||
      name === "test-designer" ||
      name === "test-writer"
        ? "allowed"
        : "forbidden",
    allowedActions: [name],
    focus: name,
  };
}

async function createTempProject(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-role-"));
  tempDirs.push(root);
  return root;
}

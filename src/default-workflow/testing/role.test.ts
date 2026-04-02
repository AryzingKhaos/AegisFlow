import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileArtifactManager } from "../persistence/task-store";
import { resolveRoleCodexConfig } from "../role/config";
import { CodexCliRoleAgentExecutor } from "../role/executor";
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
          source.endsWith("/roleflow/roles/critic.md"),
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
          warning.includes("critic.md"),
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

    expect(configContent).toContain('type: "default-workflow"');
    expect(configContent).toContain('artifactDir: ".aegisflow/artifacts"');
    expect(configContent).toContain('snapshotDir: ".aegisflow/state"');
    expect(configContent).toContain('logDir: ".aegisflow/logs"');
    expect(configContent).toContain('prototypeDir: "/Users/aaron/code/roleflow/roles"');
    expect(configContent).toContain('promptDir: ".aegisflow/roles"');
    expect(configContent).toContain('type: "child_process"');
    expect(configContent).toContain('type: "codex"');
    expect(configContent).toContain('command: "codex"');
    expect(configContent).toContain('cwd: "."');
    expect(configContent).toContain("timeoutMs: 300000");
    expect(configContent).toContain("passthrough: true");
    expect(configContent).not.toContain("frontend-critic.md");
    expect(projectRoleIndex).toContain("[critic.md](critic.md)");
    expect(projectRoleIndex).not.toContain("[frontend-critic.md](frontend-critic.md)");
    expect(sourceRoleIndex).toContain("[critic.md](critic.md)");
    expect(sourceRoleIndex).not.toContain("[frontend-critic.md]");
  });

  it("keeps materialized project role prompts aligned with source role prompts", async () => {
    const sourceDir = path.resolve(process.cwd(), "roleflow/context/roles");
    const materializedDir = path.resolve(process.cwd(), ".aegisflow/roles");
    const sourceFiles = (await readdir(sourceDir)).filter((file) => file.endsWith(".md"));
    const materializedFiles = (await readdir(materializedDir)).filter((file) =>
      file.endsWith(".md"),
    );

    expect(materializedFiles.sort()).toEqual(sourceFiles.sort());

    for (const fileName of sourceFiles) {
      const sourceContent = await readFile(path.join(sourceDir, fileName), "utf8");
      const materializedContent = await readFile(
        path.join(materializedDir, fileName),
        "utf8",
      );

      expect(materializedContent).toBe(sourceContent);
    }
  });

  it("executes role output through the agent pipeline instead of local placeholder text", async () => {
    let observedPrompt = "";
    const visibleOutputs: string[] = [];
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
      executor: {
        executorKind: "fake-codex-executor",
        async execute({ prompt }) {
          observedPrompt = prompt;

          return JSON.stringify({
            summary: prompt.includes("design_plan")
              ? "planner 已通过 agent 输出计划"
              : "unexpected",
            artifacts: ["# plan artifact\n\nfrom-agent"],
            metadata: {
              source: "fake-codex-executor",
            },
          });
        },
      },
      prompt: "SYSTEM_PROMPT",
      promptSources: ["builtin/planner.md"],
      promptWarnings: [],
      config: {
        model: "codex-5.4",
        baseUrl: "http://localhost",
        apiKey: "dummy",
        executionMode: "agent",
        sources: {
          model: "AEGISFLOW_ROLE_CODEX_MODEL",
          baseUrl: "AEGISFLOW_ROLE_CODEX_BASE_URL",
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
        async emitVisibleOutput(output) {
          visibleOutputs.push(output.message);
        },
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
    expect(result.metadata?.source).toBe("fake-codex-executor");
    expect(result.metadata?.executionMode).toBe("agent");
    expect(result.metadata?.agentExecutor).toBe("fake-codex-executor");
    expect(result.metadata?.agentModel).toBe("codex-5.4");
    expect(observedPrompt).toContain("SYSTEM_PROMPT");
    expect(observedPrompt).toContain("design_plan");
    expect(visibleOutputs).toEqual([
      "角色 planner 已开始执行，当前阶段：plan。",
      "planner 已通过 agent 输出计划",
    ]);
  });

  it("executes codex cli with isolated output files and returns the written content", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });

    const observedOutputPaths: string[] = [];
    const observedSandboxes: string[] = [];
    const observedConfigOverrides: string[] = [];
    const observedEnvBaseUrls: Array<string | undefined> = [];
    const executor = new CodexCliRoleAgentExecutor({
      async runCommand(_file, args, options) {
        const outputPath = args[args.indexOf("--output-last-message") + 1];
        const sandboxValue = args[args.indexOf("--sandbox") + 1];
        const configOverrideIndex = args.indexOf("-c");
        observedOutputPaths.push(outputPath);
        observedSandboxes.push(sandboxValue);
        if (configOverrideIndex >= 0) {
          observedConfigOverrides.push(args[configOverrideIndex + 1]);
        }
        observedEnvBaseUrls.push(options.env.OPENAI_BASE_URL);
        await writeFile(outputPath, `result-${observedOutputPaths.length}`, "utf8");
      },
    });

    const baseContext = {
      phase: "build" as const,
      cwd: projectDir,
      projectConfig: createProjectConfig({
        projectDir,
        artifactDir: path.join(root, "artifacts"),
        workflow: createWorkflowSelection("bugfix"),
      }),
      roleCapabilityProfile: createCapabilityProfile("builder"),
      artifacts: {
        async get() {
          return undefined;
        },
        async list() {
          return [];
        },
      },
    };

    const firstResult = await executor.execute({
      roleName: "builder",
      prompt: "FIRST_PROMPT",
      context: {
        ...baseContext,
        taskId: "task-a",
      },
      executionProfile: createCapabilityProfile("builder"),
      config: {
        model: "codex-5.4",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "dummy",
        executionMode: "agent",
        sources: {
          model: "default",
          baseUrl: "default",
          apiKey: "OPENAI_API_KEY",
          executionMode: "default",
        },
      },
    });

    const secondResult = await executor.execute({
      roleName: "builder",
      prompt: "SECOND_PROMPT",
      context: {
        ...baseContext,
        taskId: "task-b",
      },
      executionProfile: createCapabilityProfile("builder"),
      config: {
        model: "codex-5.4",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "dummy",
        executionMode: "agent",
        sources: {
          model: "default",
          baseUrl: "default",
          apiKey: "OPENAI_API_KEY",
          executionMode: "default",
        },
      },
    });

    expect(firstResult).toBe("result-1");
    expect(secondResult).toBe("result-2");
    expect(observedOutputPaths).toHaveLength(2);
    expect(new Set(observedOutputPaths).size).toBe(2);
    expect(observedOutputPaths.every((filePath) => filePath.includes("/.aegisflow/runtime-cache/"))).toBe(true);
    expect(observedSandboxes).toEqual(["workspace-write", "workspace-write"]);
    expect(observedConfigOverrides).toEqual([
      'openai_base_url="https://api.openai.com/v1"',
      'openai_base_url="https://api.openai.com/v1"',
    ]);
    expect(observedEnvBaseUrls).toEqual([undefined, undefined]);
  });

  it("streams visible codex event content during real executor execution", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });

    const visibleOutputs: string[] = [];
    const executor = new CodexCliRoleAgentExecutor({
      async runCommand(_file, args, options) {
        options.onStdoutLine?.('{"type":"thread.started","thread_id":"demo"}');
        options.onStdoutLine?.('{"type":"response.output_text.delta","delta":"正在分析代码依赖"}');
        options.onStdoutLine?.('{"type":"response.output_text.delta","delta":"\\n准备修改方案"}');

        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(
          outputPath,
          JSON.stringify({
            summary: "builder 完成",
            artifacts: [],
          }),
          "utf8",
        );
      },
    });

    const result = await executeRoleAgent({
      bootstrap: {
        executor,
        prompt: "SYSTEM_PROMPT",
        promptSources: ["builtin/builder.md"],
        promptWarnings: [],
        config: {
          model: "codex-5.4",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "dummy",
          executionMode: "agent",
          sources: {
            model: "default",
            baseUrl: "default",
            apiKey: "OPENAI_API_KEY",
            executionMode: "default",
          },
        },
      },
      roleName: "builder",
      executionProfile: createCapabilityProfile("builder"),
      context: {
        taskId: "task_streaming_real_executor",
        phase: "build",
        cwd: projectDir,
        projectConfig: createProjectConfig({
          projectDir,
          artifactDir: path.join(root, "artifacts"),
          workflow: createWorkflowSelection("bugfix"),
        }),
        roleCapabilityProfile: createCapabilityProfile("builder"),
        async emitVisibleOutput(output) {
          visibleOutputs.push(output.message);
        },
        artifacts: {
          async get() {
            return undefined;
          },
          async list() {
            return [];
          },
        },
      },
      input: "实现登录修复",
    });

    expect(result.summary).toBe("builder 完成");
    expect(visibleOutputs).toEqual([
      "角色 builder 已开始执行，当前阶段：build。",
      "正在分析代码依赖",
      "\n准备修改方案",
      "builder 完成",
    ]);
  });

  it("keeps codex cli visible output whitespace exactly as received", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });

    const visibleOutputs: string[] = [];
    const executor = new CodexCliRoleAgentExecutor({
      async runCommand(_file, args, options) {
        options.onStdoutLine?.(
          '{"type":"response.output_text.delta","delta":"\\n```ts\\nconst value = 1;\\n```\\n"}',
        );

        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(
          outputPath,
          JSON.stringify({
            summary: "builder 完成",
            artifacts: [],
          }),
          "utf8",
        );
      },
    });

    await executeRoleAgent({
      bootstrap: {
        executor,
        prompt: "SYSTEM_PROMPT",
        promptSources: ["builtin/builder.md"],
        promptWarnings: [],
        config: {
          model: "codex-5.4",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "dummy",
          executionMode: "agent",
          sources: {
            model: "default",
            baseUrl: "default",
            apiKey: "OPENAI_API_KEY",
            executionMode: "default",
          },
        },
      },
      roleName: "builder",
      executionProfile: createCapabilityProfile("builder"),
      context: {
        taskId: "task_streaming_whitespace",
        phase: "build",
        cwd: projectDir,
        projectConfig: createProjectConfig({
          projectDir,
          artifactDir: path.join(root, "artifacts"),
          workflow: createWorkflowSelection("bugfix"),
        }),
        roleCapabilityProfile: createCapabilityProfile("builder"),
        async emitVisibleOutput(output) {
          visibleOutputs.push(output.message);
        },
        artifacts: {
          async get() {
            return undefined;
          },
          async list() {
            return [];
          },
        },
      },
      input: "实现登录修复",
    });

    expect(visibleOutputs).toContain("\n```ts\nconst value = 1;\n```\n");
  });

  it("wraps codex cli execution failures with role executor context", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });

    const executor = new CodexCliRoleAgentExecutor({
      async runCommand() {
        throw new Error("codex exited with code 1");
      },
    });

    await expect(
      executor.execute({
        roleName: "critic",
        prompt: "PROMPT",
        context: {
          taskId: "task-error",
          phase: "review",
          cwd: projectDir,
          projectConfig: createProjectConfig({
            projectDir,
            artifactDir: path.join(root, "artifacts"),
            workflow: createWorkflowSelection("bugfix"),
          }),
          roleCapabilityProfile: createCapabilityProfile("critic"),
          artifacts: {
            async get() {
              return undefined;
            },
            async list() {
              return [];
            },
          },
        },
        executionProfile: createCapabilityProfile("critic"),
        config: {
          model: "codex-5.4",
          baseUrl: "https://api.openai.com/v1",
          apiKey: "dummy",
          executionMode: "agent",
          sources: {
            model: "default",
            baseUrl: "default",
            apiKey: "OPENAI_API_KEY",
            executionMode: "default",
          },
        },
      }),
    ).rejects.toThrow("Role agent execution failed: codex exited with code 1");
  });

  it("resolves codex-specific role config from centralized environment variables", () => {
    const config = resolveRoleCodexConfig({
      OPENAI_API_KEY: "dummy",
      AEGISFLOW_ROLE_CODEX_MODEL: "codex-5.4-custom",
      AEGISFLOW_ROLE_CODEX_BASE_URL: "https://example.test/v1",
    });

    expect(config.model).toBe("codex-5.4-custom");
    expect(config.baseUrl).toBe("https://example.test/v1");
    expect(config.apiKey).toBe("dummy");
    expect(config.sources.model).toBe("AEGISFLOW_ROLE_CODEX_MODEL");
    expect(config.sources.baseUrl).toBe("AEGISFLOW_ROLE_CODEX_BASE_URL");
    expect(config.sources.apiKey).toBe("OPENAI_API_KEY");
  });

  it("defaults role codex config to codex 5.4 and OpenAI base url", () => {
    const config = resolveRoleCodexConfig({
      OPENAI_API_KEY: "dummy",
    });

    expect(config.model).toBe("codex-5.4");
    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.sources.model).toBe("default");
    expect(config.sources.baseUrl).toBe("default");
  });

  it("creates project config with codex cli executor defaults and overrides", () => {
    const defaultConfig = createProjectConfig({
      projectDir: "/tmp/project",
      artifactDir: "/tmp/project/.aegisflow/artifacts",
      workflow: createWorkflowSelection("bugfix"),
    });
    const customConfig = createProjectConfig({
      projectDir: "/tmp/project",
      artifactDir: "/tmp/project/.aegisflow/artifacts",
      workflow: createWorkflowSelection("bugfix"),
      roleExecutor: {
        transport: {
          cwd: ".aegisflow/runtime",
          timeoutMs: 120000,
          env: {
            passthrough: false,
          },
        },
        provider: {
          command: "custom-codex",
        },
      },
    });

    expect(defaultConfig.roleExecutor).toEqual({
      transport: {
        type: "child_process",
        cwd: "/tmp/project",
        timeoutMs: 300000,
        env: {
          passthrough: true,
        },
      },
      provider: {
        type: "codex",
        command: "codex",
      },
    });
    expect(customConfig.roleExecutor).toEqual({
      transport: {
        type: "child_process",
        cwd: "/tmp/project/.aegisflow/runtime",
        timeoutMs: 120000,
        env: {
          passthrough: false,
        },
      },
      provider: {
        type: "codex",
        command: "custom-codex",
      },
    });
  });

  it("keeps repeated codex executions in one-shot mode without resume semantics", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });

    const observedArgs: string[][] = [];
    const executor = new CodexCliRoleAgentExecutor({
      async runCommand(_file, args, options) {
        observedArgs.push(args);

        if (observedArgs.length === 1) {
          options.onStdoutLine?.('{"type":"thread.started","thread_id":"session-builder-1"}');
        }

        const outputPath = args[args.indexOf("--output-last-message") + 1];
        await writeFile(
          outputPath,
          JSON.stringify({
            summary: `result-${observedArgs.length}`,
            artifacts: [],
          }),
          "utf8",
        );
      },
    });

    const context = {
      taskId: "task_session_reuse_case",
      phase: "build" as const,
      cwd: projectDir,
      projectConfig: createProjectConfig({
        projectDir,
        artifactDir: path.join(root, "artifacts"),
        workflow: createWorkflowSelection("bugfix"),
      }),
      roleCapabilityProfile: createCapabilityProfile("builder"),
      artifacts: {
        async get() {
          return undefined;
        },
        async list() {
          return [];
        },
      },
    };

    const first = await executor.execute({
      roleName: "builder",
      prompt: "FIRST_PROMPT",
      context,
      executionProfile: createCapabilityProfile("builder"),
      config: {
        model: "codex-5.4",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "dummy",
        executionMode: "agent",
        sources: {
          model: "default",
          baseUrl: "default",
          apiKey: "OPENAI_API_KEY",
          executionMode: "default",
        },
      },
    });

    const second = await executor.execute({
      roleName: "builder",
      prompt: "SECOND_PROMPT",
      context,
      executionProfile: createCapabilityProfile("builder"),
      config: {
        model: "codex-5.4",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "dummy",
        executionMode: "agent",
        sources: {
          model: "default",
          baseUrl: "default",
          apiKey: "OPENAI_API_KEY",
          executionMode: "default",
        },
      },
    });

    expect(first).toContain("result-1");
    expect(second).toContain("result-2");
    expect(observedArgs[0][0]).toBe("exec");
    expect(observedArgs[0]).not.toContain("resume");
    expect(observedArgs[0].at(-1)).toBe("FIRST_PROMPT");
    expect(observedArgs[0]).not.toContain("-");
    expect(observedArgs[0]).toContain('-c');
    expect(observedArgs[0]).toContain('openai_base_url="https://api.openai.com/v1"');
    expect(observedArgs[1][0]).toBe("exec");
    expect(observedArgs[1]).not.toContain("resume");
    expect(observedArgs[1]).not.toContain("session-builder-1");
    expect(observedArgs[1].at(-1)).toBe("SECOND_PROMPT");
    expect(observedArgs[1]).not.toContain("-");
    expect(observedArgs[1]).toContain('-c');
    expect(observedArgs[1]).toContain('openai_base_url="https://api.openai.com/v1"');
  });

  it("passes read-only ExecutionContext into roles and persists string artifacts", async () => {
    const root = await createTempProject();
    const projectDir = path.join(root, "project");
    const artifactDir = path.join(root, "artifacts");
    await mkdir(projectDir, { recursive: true });

    const workflowPhases: WorkflowPhaseConfig[] = [
      {
        name: "explore",
        hostRole: "explorer",
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
        explorer: createRole("explorer", async (_input, context) => {
          observedContext = context as unknown as Record<string, unknown>;
          expect(await context.artifacts.list()).toEqual([]);
          expect(context.roleCapabilityProfile.sideEffects).toBe("forbidden");

          return {
            summary: "explorer done",
            artifacts: ["# explore artifact\n\ncontent"],
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
      "explore",
      "explore-explorer-1.md",
    );
    const artifactContent = await readFile(artifactPath, "utf8");
    expect(artifactContent).toBe("# explore artifact\n\ncontent");
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

class FakeNodePtyTerminal {
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<
    (event: { exitCode: number; signal?: number }) => void
  > = [];

  public onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  public onExit(listener: (event: { exitCode: number; signal?: number }) => void): void {
    this.exitListeners.push(listener);
  }

  public write(_data: string): void {
    return;
  }

  public kill(): void {
    return;
  }

  public emitExit(event: { exitCode: number; signal?: number }): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

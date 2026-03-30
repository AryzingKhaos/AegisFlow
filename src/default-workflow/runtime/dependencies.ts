import { promises as fs } from "node:fs";
import path from "node:path";
import type { EventEmitter } from "node:events";
import type {
  EventLogger,
  ProjectConfig,
  Role,
  RoleCapabilityProfile,
  RoleDefinition,
  RoleName,
  RoleRegistry,
  RoleRuntime,
  WorkflowEvent,
} from "../shared/types";
import {
  executeRoleAgent,
  initializeRoleAgent,
} from "../role/model";

export class JsonlEventLogger implements EventLogger {
  public constructor(private readonly logFilePath: string) {}

  public async append(event: WorkflowEvent): Promise<void> {
    await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
    await fs.appendFile(
      this.logFilePath,
      `${JSON.stringify(event, null, 0)}\n`,
      "utf8",
    );
  }
}

interface DefaultRoleRegistryDependencies {
  projectConfig: ProjectConfig;
  eventEmitter: EventEmitter;
  eventLogger: EventLogger;
}

export class DefaultRoleRegistry implements RoleRegistry {
  private readonly roleDefinitions = new Map<RoleName, RoleDefinition>();
  private readonly roleInstances = new Map<RoleName, Role>();

  public constructor(
    private readonly dependencies: DefaultRoleRegistryDependencies,
  ) {
    for (const roleDefinition of createDefaultRoleDefinitions()) {
      this.register(roleDefinition);
    }
  }

  public register(roleDef: RoleDefinition): void {
    // 重新注册同名角色时同时清掉实例缓存，
    // 确保后续 get() 一定使用最新蓝图重新创建实例。
    this.roleDefinitions.set(roleDef.name, roleDef);
    this.roleInstances.delete(roleDef.name);
  }

  public get(name: RoleName): Role {
    const cachedRole = this.roleInstances.get(name);

    if (cachedRole) {
      return cachedRole;
    }

    const roleDefinition = this.roleDefinitions.get(name);

    if (!roleDefinition) {
      throw new Error(`Role not registered: ${name}`);
    }

    // 同一 Runtime 内同名角色只初始化一次，
    // 避免重复拼装模型与 prompt，同时保持注册表作为唯一实例化入口。
    const role = roleDefinition.create(this.createRoleRuntime());
    this.roleInstances.set(name, role);
    return role;
  }

  public list(): string[] {
    return [...this.roleDefinitions.keys()].sort();
  }

  private createRoleRuntime(): RoleRuntime {
    // RoleRuntime 只暴露角色初始化真正需要的共享依赖，
    // 防止角色在 create() 阶段越权触碰 Workflow 内部状态。
    return {
      projectConfig: this.dependencies.projectConfig,
      eventEmitter: this.dependencies.eventEmitter,
      eventLogger: this.dependencies.eventLogger,
      roleRegistry: this,
      roleCapabilityProfiles: DEFAULT_ROLE_EXECUTION_PROFILES,
    };
  }
}

export function createDefaultRoleDefinitions(): RoleDefinition[] {
  return [
    createDefaultRoleDefinition(
      "clarifier",
      "澄清需求并输出结构化需求结果。",
      DEFAULT_ROLE_EXECUTION_PROFILES.clarifier,
    ),
    createDefaultRoleDefinition(
      "explorer",
      "探索上下文与代码，并输出探索结果。",
      DEFAULT_ROLE_EXECUTION_PROFILES.explorer,
    ),
    createDefaultRoleDefinition(
      "planner",
      "生成实施方案与计划。",
      DEFAULT_ROLE_EXECUTION_PROFILES.planner,
    ),
    createDefaultRoleDefinition(
      "builder",
      "按照计划执行代码实现。",
      DEFAULT_ROLE_EXECUTION_PROFILES.builder,
    ),
    createDefaultRoleDefinition(
      "critic",
      "执行审查并输出风险问题。",
      DEFAULT_ROLE_EXECUTION_PROFILES.critic,
    ),
    createDefaultRoleDefinition(
      "test-designer",
      "输出测试设计与回归建议。",
      DEFAULT_ROLE_EXECUTION_PROFILES["test-designer"],
    ),
    createDefaultRoleDefinition(
      "tester",
      "执行测试阶段任务并输出测试执行结果。",
      DEFAULT_ROLE_EXECUTION_PROFILES.tester,
    ),
    createDefaultRoleDefinition(
      "test-writer",
      "新增或修改单元测试与测试辅助代码。",
      DEFAULT_ROLE_EXECUTION_PROFILES["test-writer"],
    ),
  ];
}

function createDefaultRoleDefinition(
  name: RoleName,
  description: string,
  executionProfile: RoleCapabilityProfile,
): RoleDefinition {
  return {
    name,
    description,
    create(roleRuntime: RoleRuntime): Role {
      let bootstrapPromise:
        | ReturnType<typeof initializeRoleAgent>
        | null = null;

      const ensureBootstrap = () => {
        // 模型与 prompt 初始化代价较高，延迟到首次 run 时再创建，
        // 同时在同一角色实例内复用同一个 bootstrap 结果。
        bootstrapPromise ??= initializeRoleAgent(name, roleRuntime);
        return bootstrapPromise;
      };

      return {
        name,
        description,
        // 默认角色已切到统一 Agent 执行链路，不再是仅返回模板字符串的占位对象。
        placeholder: false,
        capabilityProfile: executionProfile,
        async run(input, context) {
          const bootstrap = await ensureBootstrap();

          return executeRoleAgent({
            bootstrap,
            roleName: name,
            executionProfile,
            context,
            input,
          });
        },
      };
    },
  };
}

const DEFAULT_ROLE_EXECUTION_PROFILES: Record<RoleName, RoleCapabilityProfile> = {
  clarifier: {
    mode: "analysis",
    sideEffects: "forbidden",
    allowedActions: ["clarify_requirement", "structure_requirement"],
    focus: "识别需求边界、缺失信息和验收口径，不提前输出实现方案。",
  },
  explorer: {
    mode: "analysis",
    sideEffects: "forbidden",
    allowedActions: ["inspect_context", "summarize_codebase"],
    focus: "探索代码上下文、依赖关系和风险，不直接修改代码。",
  },
  planner: {
    mode: "analysis",
    sideEffects: "forbidden",
    allowedActions: ["design_plan", "sequence_steps"],
    focus: "形成可执行的实施计划，不直接实现代码。",
  },
  builder: {
    mode: "delivery",
    sideEffects: "allowed",
    allowedActions: ["modify_code_within_scope", "summarize_delivery"],
    focus: "按计划执行实现，可以产生职责内副作用，但不能推进 Workflow。",
  },
  critic: {
    mode: "analysis",
    sideEffects: "forbidden",
    allowedActions: ["review_risks", "report_findings"],
    focus: "聚焦问题识别、回归风险和审查结论，不负责修改代码。",
  },
  "test-designer": {
    mode: "verification",
    sideEffects: "allowed",
    allowedActions: ["design_test_strategy", "prepare_debug_plan"],
    focus: "输出测试设计与验证策略，允许职责内调试准备。",
  },
  tester: {
    mode: "verification",
    sideEffects: "allowed",
    allowedActions: ["execute_tests", "summarize_test_results"],
    focus: "执行测试并汇总结果，不替代 test-writer 编写单测。",
  },
  "test-writer": {
    mode: "delivery",
    sideEffects: "allowed",
    allowedActions: ["write_tests", "adjust_test_helpers"],
    focus: "新增或修改测试代码，不替代 builder 修改主业务逻辑。",
  },
};

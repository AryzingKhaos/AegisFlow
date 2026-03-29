import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  EventLogger,
  ExecutionContext,
  Role,
  RoleDescriptor,
  RoleName,
  RoleRegistry,
  RoleResult,
  WorkflowEvent,
} from "../shared/types";

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

export class StaticRoleRegistry implements RoleRegistry {
  private readonly roles = new Map<RoleName, Role>([
    ["clarifier", createPlaceholderRole("clarifier", "澄清需求并输出结构化需求工件。")],
    ["explorer", createPlaceholderRole("explorer", "探索上下文并输出 exploration 工件。")],
    ["planner", createPlaceholderRole("planner", "生成 implementation plan 工件。")],
    ["builder", createPlaceholderRole("builder", "基于计划执行代码实现。")],
    ["critic", createPlaceholderRole("critic", "执行审查并输出 review 工件。")],
    [
      "test-designer",
      createPlaceholderRole("test-designer", "输出测试设计与回归建议。"),
    ],
    [
      "test-writer",
      createPlaceholderRole("test-writer", "生成或修改单元测试相关产物。"),
    ],
    [
      "tester",
      createPlaceholderRole(
        "tester",
        "执行测试 phase 的占位角色；当前仓库缺少 tester 角色文档。",
      ),
    ],
  ]);

  public get(name: RoleName): Role {
    const role = this.roles.get(name);

    if (!role) {
      throw new Error(`Role not registered: ${name}`);
    }

    return role;
  }

  public list(): RoleDescriptor[] {
    return [...this.roles.values()].map((role) => ({
      name: role.name,
      description: role.description,
      placeholder: role.placeholder,
    }));
  }
}

function createPlaceholderRole(name: RoleName, description: string): Role {
  return {
    name,
    description,
    placeholder: true,
    async run(input: string, context: ExecutionContext): Promise<RoleResult> {
      const artifactKey = `${context.phase}-${name}`;

      return {
        summary: `${name} completed ${context.phase} with placeholder execution.`,
        artifacts: [
          {
            key: artifactKey,
            phase: context.phase,
            roleName: name,
            title: `${context.phase}-${name}`,
            content: createPlaceholderArtifactContent(name, input, context),
          },
        ],
        metadata: {
          placeholder: true,
          description,
        },
      };
    },
  };
}

function createPlaceholderArtifactContent(
  roleName: RoleName,
  input: string,
  context: ExecutionContext,
): string {
  return [
    `# ${context.phase} Placeholder Artifact`,
    "",
    `- role: ${roleName}`,
    `- taskId: ${context.taskId}`,
    `- projectDir: ${context.cwd}`,
    `- latestInput: ${input || "(empty)"}`,
    "",
    "This artifact is produced by the current v0.1 placeholder workflow runtime.",
  ].join("\n");
}

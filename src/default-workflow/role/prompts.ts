import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProjectConfig, RoleName } from "../shared/types";

// 角色原型属于跨项目复用资源，当前按用户已确认路径读取。
// AegisFlow 项目侧角色提示词则从 projectConfig.targetProjectRolePromptPath 读取。
const ROLE_PROTOTYPE_ROOT = "/Users/aaron/code/roleflow/roles";

const BUILTIN_ROLE_FILE_MAP: Record<RoleName, string> = {
  clarifier: "clarifier.md",
  explorer: "explorer.md",
  planner: "planner.md",
  builder: "builder.md",
  critic: "critic.md",
  "test-designer": "test-designer.md",
  tester: "tester.md",
  "test-writer": "test-writer.md",
};

export interface RolePromptBundle {
  prompt: string;
  promptSources: string[];
  promptWarnings: string[];
}

export async function buildRolePrompt(
  roleName: RoleName,
  projectConfig: ProjectConfig,
): Promise<RolePromptBundle> {
  const promptWarnings: string[] = [];
  const promptSources: string[] = [];
  // 第一段固定为公共系统约束，后续再叠加角色原型文档和项目侧补充文档。
  const sections = [
    [
      "你是 AegisFlow default-workflow 中的专职角色 Agent。",
      `当前角色：${roleName}`,
      "你必须遵守角色职责边界，可以执行职责内副作用，但不能推进 Workflow 状态、不能直接写工件、不能假扮 Intake。",
      "若目标项目补充了角色提示词，则项目侧职责约束优先于角色原型文档。",
    ].join("\n"),
  ];

  const prototypeCommonPath = path.join(ROLE_PROTOTYPE_ROOT, "common.md");
  const prototypeRolePath = path.join(
    ROLE_PROTOTYPE_ROOT,
    BUILTIN_ROLE_FILE_MAP[roleName],
  );
  const prototypeCommonContent = await readFileIfExists(prototypeCommonPath);
  const prototypeRoleContent = await readFileIfExists(prototypeRolePath);

  if (prototypeCommonContent) {
    promptSources.push(prototypeCommonPath);
    sections.push(`## 角色公共原型\n\n${prototypeCommonContent}`);
  } else {
    promptWarnings.push(`缺少角色公共原型文档：${prototypeCommonPath}`);
  }

  if (prototypeRoleContent) {
    promptSources.push(prototypeRolePath);
    sections.push(`## 角色原型职责\n\n${prototypeRoleContent}`);
  } else {
    promptWarnings.push(`缺少角色原型文档：${prototypeRolePath}`);
  }

  const projectCommonPath = resolveProjectCommonPromptFilePath(projectConfig);
  const projectCommonContent = await readFileIfExists(projectCommonPath);

  if (projectCommonContent) {
    promptSources.push(projectCommonPath);
    // 项目侧 common.md 表示所有角色共享的实例层公共约束，
    // 例如输出语言、项目预读材料等，不能因为只读取同名角色文件而整体漏掉。
    sections.push(
      [
        "## AegisFlow 项目公共补充约束",
        "",
        "以下内容对所有角色生效，优先级高于角色原型公共文档。",
        "",
        projectCommonContent,
      ].join("\n"),
    );
  } else {
    promptWarnings.push(`未找到目标项目公共角色提示词：${projectCommonPath}`);
  }

  const projectPromptFilePath = resolveProjectRolePromptFilePath(
    roleName,
    projectConfig,
  );
  const projectPromptContent = await readFileIfExists(projectPromptFilePath);

  if (projectPromptContent) {
    promptSources.push(projectPromptFilePath);
    // 项目侧文档采用追加组装，但语义优先级高于角色原型文档；
    // 这样既能保留公共约束，也能让目标项目覆盖角色细节。
    sections.push(
      [
        "## AegisFlow 项目角色补充约束",
        "",
        "以下内容来自目标项目，优先级高于角色原型文档。",
        "",
        projectPromptContent,
      ].join("\n"),
    );
  } else {
    promptWarnings.push(`未找到目标项目角色提示词：${projectPromptFilePath}`);
  }

  return {
    prompt: sections.join("\n\n"),
    promptSources,
    promptWarnings,
  };
}

export function resolveProjectCommonPromptFilePath(
  projectConfig: ProjectConfig,
): string {
  return path.join(projectConfig.targetProjectRolePromptPath, "common.md");
}

export function resolveProjectRolePromptFilePath(
  roleName: RoleName,
  projectConfig: ProjectConfig,
): string {
  const overrideFilePath = projectConfig.rolePromptOverrides[roleName];

  if (overrideFilePath) {
    // override 表示目标项目为该角色显式指定了补充提示词文件，
    // 其优先级高于 promptDir 下默认同名文件。
    return path.isAbsolute(overrideFilePath)
      ? overrideFilePath
      : path.resolve(projectConfig.projectDir, overrideFilePath);
  }

  return path.join(projectConfig.targetProjectRolePromptPath, `${roleName}.md`);
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    // 角色补充文档缺失不应阻断启动，由上层通过 warning 记录并回退到内置职责。
    return null;
  }
}

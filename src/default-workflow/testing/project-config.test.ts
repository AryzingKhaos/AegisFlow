import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProjectWorkflowCatalog } from "../runtime/project-config";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("project workflow config", () => {
  it("parses artifactInputPhases from workflow phase config", async () => {
    const projectDir = await createTempProjectDir();

    await writeWorkflowConfig(
      projectDir,
      [
        "workflows:",
        '  - name: "default-delivery-workflow"',
        '    description: "完整交付流程。"',
        "    phases:",
        '      - name: "clarify"',
        '        hostRole: "clarifier"',
        "        needApproval: false",
        '      - name: "plan"',
        '        hostRole: "planner"',
        "        needApproval: true",
        '        artifactInputPhases: ["clarify"]',
        '      - name: "build"',
        '        hostRole: "builder"',
        "        needApproval: false",
        '        artifactInputPhases: ["clarify", "plan"]',
      ],
    );

    const catalog = await loadProjectWorkflowCatalog(projectDir);

    expect(catalog.workflows[0].phases).toEqual([
      {
        name: "clarify",
        hostRole: "clarifier",
        needApproval: false,
      },
      {
        name: "plan",
        hostRole: "planner",
        needApproval: true,
        artifactInputPhases: ["clarify"],
      },
      {
        name: "build",
        hostRole: "builder",
        needApproval: false,
        artifactInputPhases: ["clarify", "plan"],
      },
    ]);
  });

  it("rejects non-array artifactInputPhases", async () => {
    const projectDir = await createTempProjectDir();

    await writeWorkflowConfig(
      projectDir,
      [
        "workflows:",
        '  - name: "invalid-workflow"',
        '    description: "非法字段类型。"',
        "    phases:",
        '      - name: "plan"',
        '        hostRole: "planner"',
        "        needApproval: true",
        '        artifactInputPhases: "clarify"',
      ],
    );

    await expect(loadProjectWorkflowCatalog(projectDir)).rejects.toThrow(
      "artifactInputPhases 必须是 phase 名数组",
    );
  });

  it("rejects undefined phase references inside artifactInputPhases", async () => {
    const projectDir = await createTempProjectDir();

    await writeWorkflowConfig(
      projectDir,
      [
        "workflows:",
        '  - name: "invalid-workflow"',
        '    description: "非法阶段引用。"',
        "    phases:",
        '      - name: "plan"',
        '        hostRole: "planner"',
        "        needApproval: true",
        '      - name: "build"',
        '        hostRole: "builder"',
        "        needApproval: false",
        '        artifactInputPhases: ["clarify", "plan"]',
      ],
    );

    await expect(loadProjectWorkflowCatalog(projectDir)).rejects.toThrow(
      "artifactInputPhases 引用了未定义阶段：clarify",
    );
  });

  it("parses block-style artifactInputPhases arrays", async () => {
    const projectDir = await createTempProjectDir();

    await writeWorkflowConfig(
      projectDir,
      [
        "workflows:",
        '  - name: "block-array-workflow"',
        '    description: "块状数组解析。"',
        "    phases:",
        '      - name: "clarify"',
        '        hostRole: "clarifier"',
        "        needApproval: false",
        '      - name: "plan"',
        '        hostRole: "planner"',
        "        needApproval: true",
        "        artifactInputPhases:",
        "          - clarify",
        '      - name: "build"',
        '        hostRole: "builder"',
        "        needApproval: false",
        "        artifactInputPhases:",
        "          - clarify",
        "          - plan",
      ],
    );

    const catalog = await loadProjectWorkflowCatalog(projectDir);

    expect(catalog.workflows[0].phases[1].artifactInputPhases).toEqual([
      "clarify",
    ]);
    expect(catalog.workflows[0].phases[2].artifactInputPhases).toEqual([
      "clarify",
      "plan",
    ]);
  });

  it("rejects artifactInputPhases that reference the current or a downstream phase", async () => {
    const projectDir = await createTempProjectDir();

    await writeWorkflowConfig(
      projectDir,
      [
        "workflows:",
        '  - name: "invalid-order-workflow"',
        '    description: "非法上游引用。"',
        "    phases:",
        '      - name: "clarify"',
        '        hostRole: "clarifier"',
        "        needApproval: false",
        '      - name: "plan"',
        '        hostRole: "planner"',
        "        needApproval: true",
        '        artifactInputPhases: ["plan"]',
        '      - name: "build"',
        '        hostRole: "builder"',
        "        needApproval: false",
      ],
    );

    await expect(loadProjectWorkflowCatalog(projectDir)).rejects.toThrow(
      "artifactInputPhases 只能引用当前阶段之前的上游阶段：plan",
    );
  });

  it("keeps artifactInputPhases undefined when the field is not configured", async () => {
    const projectDir = await createTempProjectDir();

    await writeWorkflowConfig(
      projectDir,
      [
        "workflows:",
        '  - name: "default-fallback-workflow"',
        '    description: "默认回退场景。"',
        "    phases:",
        '      - name: "clarify"',
        '        hostRole: "clarifier"',
        "        needApproval: false",
        '      - name: "explore"',
        '        hostRole: "explorer"',
        "        needApproval: false",
      ],
    );

    const catalog = await loadProjectWorkflowCatalog(projectDir);

    expect(catalog.workflows[0].phases[0].artifactInputPhases).toBeUndefined();
    expect(catalog.workflows[0].phases[1].artifactInputPhases).toBeUndefined();
  });
});

async function createTempProjectDir(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "aegisflow-project-config-"));
  const projectDir = path.join(root, "project");
  tempDirs.push(root);
  await mkdir(path.join(projectDir, ".aegisflow"), { recursive: true });
  return projectDir;
}

async function writeWorkflowConfig(
  projectDir: string,
  lines: string[],
): Promise<void> {
  await writeFile(
    path.join(projectDir, ".aegisflow", "aegisproject.yaml"),
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

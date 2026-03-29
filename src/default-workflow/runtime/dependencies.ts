import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  EventLogger,
  RoleDescriptor,
  RoleRegistry,
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
  private readonly roles: RoleDescriptor[] = [
    {
      name: "Clarifier",
      description:
        "Placeholder hosted role used by the v0.1 Intake runtime for basic event bridging.",
      placeholder: true,
    },
  ];

  public list(): RoleDescriptor[] {
    return this.roles;
  }
}


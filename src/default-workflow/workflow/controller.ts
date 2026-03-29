import type { EventEmitter } from "node:events";
import type {
  ArtifactManager,
  EventLogger,
  IntakeEvent,
  ProjectConfig,
  RoleRegistry,
  TaskState,
  WorkflowController,
  WorkflowEvent,
  WorkflowEventType,
} from "../shared/types";
import { TaskStatus } from "../shared/types";

interface WorkflowControllerDependencies {
  taskState: TaskState;
  projectConfig: ProjectConfig;
  eventEmitter: EventEmitter;
  eventLogger: EventLogger;
  artifactManager: ArtifactManager;
  roleRegistry: RoleRegistry;
}

export class DefaultWorkflowController implements WorkflowController {
  public constructor(private readonly dependencies: WorkflowControllerDependencies) {}

  public async handleIntakeEvent(event: IntakeEvent): Promise<WorkflowEvent[]> {
    const workflowEvents: WorkflowEvent[] = [];

    // TaskState 的推进集中在这里处理，避免 Intake 直接修改工作流状态。
    switch (event.type) {
      case "init_task":
        this.dependencies.taskState.currentPhase = "intake";
        this.dependencies.taskState.phaseStatus = "completed";
        this.dependencies.taskState.status = TaskStatus.WAITING_APPROVAL;
        this.dependencies.taskState.updatedAt = event.timestamp;
        workflowEvents.push(
          this.createWorkflowEvent(
            "progress",
            "Task initialized. Runtime is ready for task start.",
            {
              workflow: this.dependencies.projectConfig.workflow.label,
            },
          ),
        );
        break;
      case "start_task":
        this.dependencies.taskState.currentPhase = "clarify";
        this.dependencies.taskState.phaseStatus = "running";
        this.dependencies.taskState.status = TaskStatus.RUNNING;
        this.dependencies.taskState.resumeFrom = undefined;
        this.dependencies.taskState.updatedAt = event.timestamp;
        workflowEvents.push(
          this.createWorkflowEvent("task_start", "Task started."),
          this.createWorkflowEvent(
            "phase_start",
            "Clarify phase started.",
            {
              phase: "clarify",
            },
          ),
          this.createWorkflowEvent(
            "role_start",
            "Clarifier placeholder role attached to the workflow runtime.",
            {
              roles: this.dependencies.roleRegistry.list(),
            },
          ),
          this.createWorkflowEvent(
            "progress",
            "Runtime is running. Additional details can be sent as participate events.",
            {
              placeholder:
                "Downstream role execution is still represented by a controlled placeholder in v0.1.",
            },
          ),
        );
        break;
      case "participate":
        this.dependencies.taskState.updatedAt = event.timestamp;
        if (this.dependencies.taskState.status === TaskStatus.INTERRUPTED) {
          this.dependencies.taskState.status = TaskStatus.WAITING_USER_INPUT;
        }
        workflowEvents.push(
          this.createWorkflowEvent(
            "progress",
            "Additional task context received.",
            {
              latestMessage: event.message,
            },
          ),
        );
        break;
      case "interrupt_task":
        this.dependencies.taskState.phaseStatus = "waiting";
        this.dependencies.taskState.status = TaskStatus.INTERRUPTED;
        this.dependencies.taskState.resumeFrom = {
          phase: this.dependencies.taskState.currentPhase,
          roleName: "Clarifier",
          currentStep: event.message || "Waiting for resume.",
        };
        this.dependencies.taskState.updatedAt = event.timestamp;
        workflowEvents.push(
          this.createWorkflowEvent(
            "progress",
            "Task interrupted and persisted. Resume requires rebuilding Runtime.",
          ),
        );
        break;
      case "resume_task":
        this.dependencies.taskState.phaseStatus = "running";
        this.dependencies.taskState.status = TaskStatus.RUNNING;
        this.dependencies.taskState.currentPhase =
          this.dependencies.taskState.resumeFrom?.phase ??
          this.dependencies.taskState.currentPhase;
        this.dependencies.taskState.updatedAt = event.timestamp;
        workflowEvents.push(
          this.createWorkflowEvent(
            "phase_start",
            "Resumed from persisted task snapshot.",
            {
              resumeFrom: this.dependencies.taskState.resumeFrom,
            },
          ),
          this.createWorkflowEvent(
            "progress",
            "Runtime rebuilt successfully. Task execution can continue.",
          ),
        );
        break;
      case "cancel_task":
        this.dependencies.taskState.phaseStatus = "cancelled";
        this.dependencies.taskState.status = TaskStatus.FAILED;
        this.dependencies.taskState.updatedAt = event.timestamp;
        workflowEvents.push(
          this.createWorkflowEvent("task_end", "Task cancelled by user.", {
            reason: "user_cancelled",
          }),
        );
        break;
      default:
        workflowEvents.push(
          this.createWorkflowEvent(
            "error",
            `Unsupported intake event: ${event.type}`,
          ),
        );
    }

    // 每个 IntakeEvent 处理后都要刷新一次任务快照，
    // 这样中断和恢复才能依赖磁盘状态重建。
    const snapshotPath = await this.dependencies.artifactManager.saveTaskState(
      this.dependencies.taskState,
    );

    workflowEvents.push(
      this.createWorkflowEvent("artifact_created", "Task snapshot saved.", {
        path: snapshotPath,
      }),
    );

    for (const workflowEvent of workflowEvents) {
      // 当前阶段不对事件做裁剪，先完整记录并发给 CLI，
      // 满足验收阶段对全量事件信息展示的要求。
      await this.dependencies.eventLogger.append(workflowEvent);
      this.dependencies.eventEmitter.emit("workflow_event", workflowEvent);
    }

    return workflowEvents;
  }

  private createWorkflowEvent(
    type: WorkflowEventType,
    message: string,
    metadata?: Record<string, unknown>,
  ): WorkflowEvent {
    return {
      type,
      taskId: this.dependencies.taskState.taskId,
      message,
      timestamp: Date.now(),
      // 这里发送的是脱离引用的快照，
      // 避免后续状态修改反向污染已经渲染过的事件内容。
      taskState: JSON.parse(
        JSON.stringify(this.dependencies.taskState),
      ) as TaskState,
      metadata,
    };
  }
}

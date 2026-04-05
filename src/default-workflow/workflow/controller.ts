import type { EventEmitter } from "node:events";
import type {
  ArtifactManager,
  ArtifactReader,
  EventLogger,
  IntakeEvent,
  Phase,
  ProjectConfig,
  RoleName,
  RoleRegistry,
  RoleResult,
  RoleVisibleOutput,
  TaskState,
  WorkflowController,
  WorkflowEvent,
  WorkflowEventType,
  WorkflowPhaseConfig,
} from "../shared/types";
import { TaskStatus } from "../shared/types";
import {
  createGenericArtifactKey,
  normalizeFinalArtifactMarkdown,
  resolveFinalArtifactDefinition,
} from "./final-artifact";

interface WorkflowControllerDependencies {
  taskState: TaskState;
  projectConfig: ProjectConfig;
  eventEmitter: EventEmitter;
  eventLogger: EventLogger;
  artifactManager: ArtifactManager;
  roleRegistry: RoleRegistry;
}

export class DefaultWorkflowController implements WorkflowController {
  public constructor(
    private readonly dependencies: WorkflowControllerDependencies,
  ) {}

  public async handleIntakeEvent(event: IntakeEvent): Promise<WorkflowEvent[]> {
    // Intake 只负责把控制意图翻译成规范事件；
    // 真正的状态推进统一收口在 WorkflowController 内部。
    switch (event.type) {
      case "init_task":
        return this.initializeTask(event.message, event.timestamp);
      case "start_task":
        return this.run(event.taskId, event.message);
      case "participate":
        return this.handleParticipation(event.message, event.timestamp);
      case "interrupt_task":
        return this.interrupt(event.message, event.timestamp);
      case "resume_task":
        return this.resume(event.taskId, event.message);
      case "cancel_task":
        return this.cancel(event.message, event.timestamp);
      default:
        return this.failWithError(
          new Error(`Unsupported intake event: ${event.type}`),
          "收到不支持的 IntakeEvent。",
        );
    }
  }

  public async run(taskId: string, input?: string): Promise<WorkflowEvent[]> {
    const workflowEvents: WorkflowEvent[] = [];

    try {
      this.assertTaskId(taskId);
      await this.saveLatestInput(input);
      // run 表示正式进入主流程，启动时清空旧恢复点，
      // 避免把上一次暂停信息错误带入新的执行轮次。
      this.dependencies.taskState.status = TaskStatus.RUNNING;
      this.dependencies.taskState.phaseStatus =
        this.dependencies.taskState.phaseStatus === "done" ? "done" : "pending";
      this.dependencies.taskState.resumeFrom = undefined;
      this.touchTaskState();

      await this.pushEvent(workflowEvents, "task_start", "任务开始执行。", {
        workflowProfileId: this.dependencies.projectConfig.workflowProfileId,
        workflowProfileLabel: this.dependencies.projectConfig.workflowProfileLabel,
      });
      await this.saveSnapshot("task_started");

      const startPhase = this.resolveRunStartPhase();
      await this.executeFromPhase(workflowEvents, startPhase, input);

      return workflowEvents;
    } catch (error) {
      return this.failWithError(error, "任务启动失败。", workflowEvents);
    }
  }

  public async resume(taskId: string, input?: string): Promise<WorkflowEvent[]> {
    return this.resumeInternal(taskId, input, false);
  }

  public async runPhase(
    phase: Phase,
    input?: string,
  ): Promise<WorkflowEvent[]> {
    const workflowEvents: WorkflowEvent[] = [];

    try {
      await this.runPhaseInternal(workflowEvents, this.getPhaseConfig(phase), input);
      return workflowEvents;
    } catch (error) {
      return this.failWithError(
        error,
        `阶段 ${phase} 执行失败。`,
        workflowEvents,
      );
    }
  }

  public async runRole(
    roleName: RoleName,
    input: string,
    options?: {
      workflowEvents?: WorkflowEvent[];
      phase?: Phase;
    },
  ): Promise<RoleResult> {
    const role =
      this.dependencies.roleRegistry.activate?.(roleName) ??
      this.dependencies.roleRegistry.get(roleName);
    const phase = options?.phase ?? this.dependencies.taskState.currentPhase;
    // Workflow 只把最小执行上下文传给角色，
    // 不再把 TaskState、latestInput 或完整 ArtifactManager 暴露到 Role 层。
    const context = {
      taskId: this.dependencies.taskState.taskId,
      phase,
      cwd: this.dependencies.projectConfig.projectDir,
      artifacts: this.createExecutionArtifactReader(
        this.dependencies.taskState.taskId,
        phase,
      ),
      projectConfig: this.dependencies.projectConfig,
      roleCapabilityProfile: role.capabilityProfile,
      emitVisibleOutput: options?.workflowEvents
        ? async (output: RoleVisibleOutput) => {
            const activeRoleName =
              this.dependencies.roleRegistry.getActiveRoleName?.();

            if (activeRoleName && activeRoleName !== roleName) {
              return;
            }

            if (output.message.length === 0) {
              return;
            }

            await this.pushEvent(
              options.workflowEvents ?? [],
              "role_output",
              output.message,
              {
                phase,
                roleName,
                outputKind: output.kind ?? "progress",
              },
            );
          }
        : undefined,
    };

    return role.run(input, context);
  }

  private async initializeTask(
    message: string,
    timestamp: number,
  ): Promise<WorkflowEvent[]> {
    const workflowEvents: WorkflowEvent[] = [];
    const firstPhase = this.dependencies.projectConfig.workflowPhases[0];

    this.dependencies.taskState.currentPhase = firstPhase.name;
    this.dependencies.taskState.phaseStatus = "pending";
    this.dependencies.taskState.status = TaskStatus.IDLE;
    this.dependencies.taskState.resumeFrom = undefined;
    this.dependencies.taskState.updatedAt = timestamp;
    await this.saveLatestInput(message);

    // init_task 只完成 Runtime 初始化和初始快照，
    // 不会直接推进到执行态，真正开跑由 start_task 触发。
    await this.pushEvent(
      workflowEvents,
      "progress",
      "任务已初始化，Runtime 可以开始执行。",
      {
        workflowProfileLabel: this.dependencies.projectConfig.workflowProfileLabel,
        currentPhase: firstPhase.name,
      },
    );
    await this.saveSnapshot("task_initialized");
    return workflowEvents;
  }

  private async handleParticipation(
    message: string,
    timestamp: number,
  ): Promise<WorkflowEvent[]> {
    if (
      this.dependencies.taskState.status === TaskStatus.WAITING_USER_INPUT ||
      this.dependencies.taskState.status === TaskStatus.INTERRUPTED
    ) {
      // 等待补充或已中断时，新的用户输入被视为恢复材料，
      // 直接走 resume 链路，保持入口统一。
      return this.resumeInternal(this.dependencies.taskState.taskId, message, true);
    }

    if (this.dependencies.taskState.status === TaskStatus.RUNNING) {
      await this.saveLatestInput(message);
      this.dependencies.taskState.updatedAt = timestamp;
      const workflowEvents: WorkflowEvent[] = [];
      await this.pushEvent(
        workflowEvents,
        "progress",
        "当前默认执行模型为 one-shot；运行中输入不会透传到 active role，请在当前阶段结束后通过恢复链路继续。",
        {
          latestInput: message,
          activeRoleName: this.dependencies.roleRegistry.getActiveRoleName?.(),
          participationMode: "one_shot_deferred",
        },
      );
      await this.saveSnapshot("task_participation_deferred");
      return workflowEvents;
    }

    await this.saveLatestInput(message);
    this.dependencies.taskState.updatedAt = timestamp;

    const workflowEvents: WorkflowEvent[] = [];
    await this.pushEvent(workflowEvents, "progress", "已收到补充信息。", {
      latestInput: message,
    });
    await this.saveSnapshot("task_participated");
    return workflowEvents;
  }

  private async interrupt(
    message: string,
    timestamp: number,
  ): Promise<WorkflowEvent[]> {
    const workflowEvents: WorkflowEvent[] = [];
    const currentPhaseConfig = this.getPhaseConfig(
      this.dependencies.taskState.currentPhase,
    );
    const previousResumePoint = this.dependencies.taskState.resumeFrom;

    this.dependencies.taskState.status = TaskStatus.INTERRUPTED;
    this.dependencies.taskState.resumeFrom = {
      // 如果原本已经处于 waiting_approval / waiting_user_input，
      // 中断时优先保留原恢复点，避免恢复位置被回退到当前 phase。
      phase: previousResumePoint?.phase ?? this.dependencies.taskState.currentPhase,
      roleName: previousResumePoint?.roleName ?? currentPhaseConfig.hostRole,
      currentStep: message || previousResumePoint?.currentStep || "等待恢复",
    };
    this.dependencies.taskState.updatedAt = timestamp;
    await this.saveLatestInput(message);

    await this.pushEvent(workflowEvents, "progress", "任务已中断，可稍后恢复。", {
      resumeFrom: this.dependencies.taskState.resumeFrom,
    });
    await this.saveSnapshot("task_interrupted");
    return workflowEvents;
  }

  private async cancel(
    message: string,
    timestamp: number,
  ): Promise<WorkflowEvent[]> {
    const workflowEvents: WorkflowEvent[] = [];

    this.dependencies.taskState.status = TaskStatus.FAILED;
    this.dependencies.taskState.phaseStatus = this.getTerminalPhaseStatus();
    this.dependencies.taskState.updatedAt = timestamp;
    if (!this.dependencies.taskState.resumeFrom) {
      const currentPhaseConfig = this.getPhaseConfig(
        this.dependencies.taskState.currentPhase,
      );
      this.dependencies.taskState.resumeFrom = {
        phase: this.dependencies.taskState.currentPhase,
        roleName: currentPhaseConfig.hostRole,
        currentStep: "user_cancelled",
      };
    }

    await this.pushEvent(workflowEvents, "error", "任务被用户取消。", {
      reason: "user_cancelled",
      message,
    });
    await this.pushEvent(workflowEvents, "task_end", "任务已结束。", {
      status: TaskStatus.FAILED,
    });
    await this.saveSnapshot("task_cancelled");
    return workflowEvents;
  }

  private async executeFromPhase(
    workflowEvents: WorkflowEvent[],
    startPhase: WorkflowPhaseConfig,
    input?: string,
  ): Promise<void> {
    const phases = this.dependencies.projectConfig.workflowPhases;
    const startIndex = phases.findIndex((phase) => phase.name === startPhase.name);

    if (startIndex === -1) {
      throw new Error(`Workflow phase is not configured: ${startPhase.name}`);
    }

    let phaseInput = input;

    for (let index = startIndex; index < phases.length; index += 1) {
      // 只有首个恢复 phase 会携带本轮用户输入；
      // 后续 phase 默认消费前一阶段工件，不重复透传这段输入。
      await this.runPhaseInternal(workflowEvents, phases[index], phaseInput);

      if (this.dependencies.taskState.status !== TaskStatus.RUNNING) {
        return;
      }

      phaseInput = undefined;
    }

    this.dependencies.taskState.status = TaskStatus.COMPLETED;
    this.dependencies.taskState.phaseStatus = "done";
    this.dependencies.taskState.resumeFrom = undefined;
    this.touchTaskState();

    await this.pushEvent(workflowEvents, "task_end", "任务执行完成。", {
      status: TaskStatus.COMPLETED,
    });
    await this.saveSnapshot("task_completed");
  }

  private async resumeInternal(
    taskId: string,
    input: string | undefined,
    consumeInputForPhase: boolean,
  ): Promise<WorkflowEvent[]> {
    const workflowEvents: WorkflowEvent[] = [];

    try {
      this.assertTaskId(taskId);
      const previousStatus = this.dependencies.taskState.status;
      const resumePoint = this.dependencies.taskState.resumeFrom;
      const shouldPersistLatestInput = this.shouldUseResumeInput(
        previousStatus,
        consumeInputForPhase,
        resumePoint,
      );

      if (shouldPersistLatestInput) {
        await this.saveLatestInput(input);
      }

      if (this.isTerminalStatus()) {
        await this.pushEvent(
          workflowEvents,
          "progress",
          "当前任务已结束，无需恢复。",
          {
            status: this.dependencies.taskState.status,
          },
        );
        return workflowEvents;
      }

      if (
        previousStatus === TaskStatus.WAITING_APPROVAL &&
        this.shouldCompleteAfterFinalApproval(resumePoint)
      ) {
        this.dependencies.taskState.status = TaskStatus.COMPLETED;
        this.dependencies.taskState.phaseStatus = "done";
        this.dependencies.taskState.resumeFrom = undefined;
        this.touchTaskState();

        await this.pushEvent(workflowEvents, "progress", "最终审批已确认，任务完成。", {
          resumeFrom: resumePoint,
        });
        await this.pushEvent(workflowEvents, "task_end", "任务执行完成。", {
          status: TaskStatus.COMPLETED,
        });
        await this.saveSnapshot("task_completed_after_final_approval");
        return workflowEvents;
      }

      const resumePhase = this.resolveResumePhase();
      this.dependencies.taskState.status = TaskStatus.RUNNING;
      this.dependencies.taskState.currentPhase = resumePhase.name;
      // 恢复一律从“待执行”边界重新进入 phase，避免复用半途内存状态。
      this.dependencies.taskState.phaseStatus = "pending";
      this.touchTaskState();

      await this.pushEvent(workflowEvents, "progress", "任务恢复执行。", {
        resumeFrom: resumePoint,
      });
      await this.saveSnapshot("task_resumed");

      const phaseInput = shouldPersistLatestInput ? input : undefined;
      await this.executeFromPhase(workflowEvents, resumePhase, phaseInput);
      return workflowEvents;
    } catch (error) {
      return this.failWithError(error, "任务恢复失败。", workflowEvents);
    }
  }

  private async runPhaseInternal(
    workflowEvents: WorkflowEvent[],
    phaseConfig: WorkflowPhaseConfig,
    input?: string,
  ): Promise<void> {
    // phase 一开始就写入 resumeFrom，
    // 这样无论是中断、失败还是等待输入，都能回到可解释的边界。
    this.dependencies.taskState.currentPhase = phaseConfig.name;
    this.dependencies.taskState.phaseStatus = "running";
    this.dependencies.taskState.status = TaskStatus.RUNNING;
    this.dependencies.taskState.resumeFrom = {
      phase: phaseConfig.name,
      roleName: phaseConfig.hostRole,
      currentStep: "phase_running",
    };
    this.touchTaskState();

    await this.pushEvent(
      workflowEvents,
      "phase_start",
      `阶段 ${phaseConfig.name} 开始执行。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
      },
    );
    await this.saveSnapshot(`phase_${phaseConfig.name}_started`);

    if (phaseConfig.pauseForInput && !this.hasUsableInput(input)) {
      // pauseForInput 表示该阶段在真正调用角色前必须拿到额外资料；
      // 因此这里停在“phase 已进入、role 尚未执行”的边界。
      this.dependencies.taskState.status = TaskStatus.WAITING_USER_INPUT;
      this.dependencies.taskState.resumeFrom = {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        currentStep: "waiting_user_input",
      };
      this.touchTaskState();

      await this.pushEvent(
        workflowEvents,
        "progress",
        `阶段 ${phaseConfig.name} 等待用户补充输入。`,
        {
          phase: phaseConfig.name,
          roleName: phaseConfig.hostRole,
        },
      );
      await this.saveSnapshot(`phase_${phaseConfig.name}_waiting_input`);
      return;
    }

    if (phaseConfig.name === "clarify") {
      await this.runClarifyPhase(workflowEvents, phaseConfig, input);
      return;
    }

    await this.pushEvent(
      workflowEvents,
      "role_start",
      `角色 ${phaseConfig.hostRole} 开始执行。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
      },
    );

    const roleResult = await this.runRole(phaseConfig.hostRole, input ?? "", {
      workflowEvents,
      phase: phaseConfig.name,
    });

    await this.pushEvent(
      workflowEvents,
      "role_end",
      `角色 ${phaseConfig.hostRole} 执行完成。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        summary: roleResult.summary,
        metadata: roleResult.metadata,
      },
    );

    if (roleResult.artifactReady !== false) {
      const finalArtifactDefinition = resolveFinalArtifactDefinition(
        phaseConfig.name,
        phaseConfig.hostRole,
      );

      for (const [artifactIndex, artifactContent] of roleResult.artifacts.entries()) {
        // RoleResult.artifacts 只暴露工件内容字符串；
        // 真正的命名、分目录和落盘时机仍由 Workflow 统一决定。
        const artifactKey = createArtifactKey(
          phaseConfig.name,
          phaseConfig.hostRole,
          artifactIndex,
        );
        const isFinalArtifact = artifactKey === finalArtifactDefinition.key;
        const artifactPath = await this.dependencies.artifactManager.saveArtifact(
          this.dependencies.taskState.taskId,
          {
            key: artifactKey,
            phase: phaseConfig.name,
            roleName: phaseConfig.hostRole,
            title: createArtifactTitle(
              phaseConfig.name,
              phaseConfig.hostRole,
              artifactIndex,
            ),
            content: isFinalArtifact
              ? normalizeFinalArtifactMarkdown({
                  phase: phaseConfig.name,
                  roleName: phaseConfig.hostRole,
                  artifactKey,
                  rawContent: artifactContent,
                  summary: roleResult.summary,
                  metadata: roleResult.metadata,
                })
              : artifactContent,
          },
        );

        await this.pushEvent(
          workflowEvents,
          "artifact_created",
          `阶段 ${phaseConfig.name} 的第 ${artifactIndex + 1} 个工件已创建。`,
          {
            phase: phaseConfig.name,
            roleName: phaseConfig.hostRole,
            artifactPath,
            artifactIndex,
            artifactKey,
            finalArtifact: isFinalArtifact,
          },
        );
      }
    }

    if (roleResult.phaseCompleted === false) {
      this.dependencies.taskState.status = TaskStatus.WAITING_USER_INPUT;
      this.dependencies.taskState.resumeFrom = {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        currentStep:
          typeof roleResult.metadata?.currentStep === "string"
            ? roleResult.metadata.currentStep
            : "waiting_user_input",
      };
      this.touchTaskState();

      await this.pushEvent(
        workflowEvents,
        "progress",
        `阶段 ${phaseConfig.name} 暂停，等待后续输入。`,
        {
          phase: phaseConfig.name,
          roleName: phaseConfig.hostRole,
          metadata: roleResult.metadata,
        },
      );
      await this.saveSnapshot(`phase_${phaseConfig.name}_waiting_input_after_role`);
      return;
    }

    await this.completePhase(workflowEvents, phaseConfig);
  }

  private async runClarifyPhase(
    workflowEvents: WorkflowEvent[],
    phaseConfig: WorkflowPhaseConfig,
    input?: string,
  ): Promise<void> {
    const taskId = this.dependencies.taskState.taskId;
    const artifactReader = this.dependencies.artifactManager.createArtifactReader(taskId);
    const existingInitialRequirement = await artifactReader.get(
      `${phaseConfig.name}/initial-requirement`,
    );
    const existingDialogue = await artifactReader.get(
      `${phaseConfig.name}/clarify-dialogue`,
    );

    if (!existingInitialRequirement && this.hasUsableInput(input)) {
      await this.saveNamedArtifact(
        workflowEvents,
        phaseConfig,
        "initial-requirement",
        "initial-requirement",
        buildInitialRequirementArtifact(input ?? ""),
      );
    }

    if (existingDialogue && this.hasUsableInput(input)) {
      await this.saveNamedArtifact(
        workflowEvents,
        phaseConfig,
        "clarify-dialogue",
        "clarify-dialogue",
        appendClarifyDialogueAnswer(existingDialogue, input ?? ""),
      );
    }

    await this.pushEvent(
      workflowEvents,
      "role_start",
      `角色 ${phaseConfig.hostRole} 开始执行。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
      },
    );

    const roleResult = await this.runRole(
      phaseConfig.hostRole,
      input ?? "",
      {
        workflowEvents,
        phase: phaseConfig.name,
      },
    );

    await this.pushEvent(
      workflowEvents,
      "role_end",
      `角色 ${phaseConfig.hostRole} 执行完成。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        summary: roleResult.summary,
        metadata: roleResult.metadata,
      },
    );

    const decision = this.resolveClarifyDecision(roleResult);

    if (decision === "ask_next_question") {
      const question =
        typeof roleResult.metadata?.question === "string"
          ? roleResult.metadata.question.trim()
          : "";

      if (question.length === 0) {
        throw new Error("Clarify role returned ask_next_question without metadata.question.");
      }

      const currentDialogue =
        (await artifactReader.get(`${phaseConfig.name}/clarify-dialogue`)) ?? "";

      await this.saveNamedArtifact(
        workflowEvents,
        phaseConfig,
        "clarify-dialogue",
        "clarify-dialogue",
        appendClarifyDialogueQuestion(currentDialogue, question),
      );

      this.dependencies.taskState.status = TaskStatus.WAITING_USER_INPUT;
      this.dependencies.taskState.resumeFrom = {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        currentStep: "clarify_waiting_user_answer",
      };
      this.touchTaskState();

      await this.pushEvent(
        workflowEvents,
        "progress",
        question,
        {
          phase: phaseConfig.name,
          roleName: phaseConfig.hostRole,
          decision,
        },
      );
      await this.saveSnapshot("phase_clarify_waiting_user_answer");
      return;
    }

    await this.generateClarifyPrd(workflowEvents, phaseConfig);
    await this.completePhase(workflowEvents, phaseConfig);
  }

  private async generateClarifyPrd(
    workflowEvents: WorkflowEvent[],
    phaseConfig: WorkflowPhaseConfig,
  ): Promise<void> {
    await this.pushEvent(
      workflowEvents,
      "role_start",
      `角色 ${phaseConfig.hostRole} 开始生成最终 PRD。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        step: "generate_final_prd",
      },
    );

    const prdResult = await this.runRole(
      phaseConfig.hostRole,
      buildClarifyFinalPrdInput(),
      {
        workflowEvents,
        phase: phaseConfig.name,
      },
    );

    await this.pushEvent(
      workflowEvents,
      "role_end",
      `角色 ${phaseConfig.hostRole} 最终 PRD 生成完成。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        step: "generate_final_prd",
        summary: prdResult.summary,
        metadata: prdResult.metadata,
      },
    );

    if (prdResult.artifactReady === false) {
      throw new Error(
        "Clarify final PRD generation returned artifactReady=false.",
      );
    }

    if (prdResult.phaseCompleted === false) {
      throw new Error(
        "Clarify final PRD generation returned phaseCompleted=false.",
      );
    }

    const prdContent = prdResult.artifacts[0]?.trim();

    if (!prdContent) {
      throw new Error(
        "Clarify final PRD generation must return a non-empty artifact.",
      );
    }

    await this.saveNamedArtifact(
      workflowEvents,
      phaseConfig,
      "final-prd",
      "final-prd",
      normalizeFinalArtifactMarkdown({
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        artifactKey: "final-prd",
        rawContent: prdContent,
        summary: prdResult.summary,
        metadata: prdResult.metadata,
      }),
    );
  }

  private async completePhase(
    workflowEvents: WorkflowEvent[],
    phaseConfig: WorkflowPhaseConfig,
  ): Promise<void> {
    this.dependencies.taskState.phaseStatus = "done";
    this.touchTaskState();

    await this.pushEvent(
      workflowEvents,
      "phase_end",
      `阶段 ${phaseConfig.name} 执行完成。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
      },
    );
    await this.saveSnapshot(`phase_${phaseConfig.name}_completed`);

    const nextPhase = this.getNextPhaseConfig(phaseConfig.name);

    if (phaseConfig.needApproval) {
      // 审批停在“当前 phase 已完成”的边界。
      // 如果后面还有 phase，就从下一 phase 继续；如果已经是最后一个 phase，就等待最终人工确认后再完成任务。
      this.dependencies.taskState.status = TaskStatus.WAITING_APPROVAL;
      this.dependencies.taskState.resumeFrom = {
        phase: nextPhase?.name ?? phaseConfig.name,
        roleName: nextPhase?.hostRole ?? phaseConfig.hostRole,
        currentStep: nextPhase
          ? `waiting_approval_after_${phaseConfig.name}`
          : `waiting_final_approval_after_${phaseConfig.name}`,
      };
      this.touchTaskState();

      await this.pushEvent(
        workflowEvents,
        "progress",
        nextPhase
          ? `阶段 ${phaseConfig.name} 完成，等待审批后进入 ${nextPhase.name}。`
          : `阶段 ${phaseConfig.name} 完成，等待最终审批确认任务完成。`,
        {
          phase: phaseConfig.name,
          nextPhase: nextPhase?.name ?? null,
          roleName: nextPhase?.hostRole ?? phaseConfig.hostRole,
        },
      );
      await this.saveSnapshot(`phase_${phaseConfig.name}_waiting_approval`);
      return;
    }

    this.dependencies.taskState.resumeFrom = nextPhase
      ? {
          phase: nextPhase.name,
          roleName: nextPhase.hostRole,
          currentStep: "next_phase_ready",
        }
      : undefined;
    this.touchTaskState();
  }

  private createExecutionArtifactReader(
    taskId: string,
    phase: Phase,
  ): ArtifactReader {
    const baseReader = this.dependencies.artifactManager.createArtifactReader(taskId);

    return {
      get: async (key: string) => {
        const visibleKeys = await this.resolveVisibleArtifactKeys(baseReader, phase);
        const matchedKey = matchVisibleArtifactKey(key, visibleKeys);

        if (!matchedKey) {
          return undefined;
        }

        return baseReader.get(matchedKey);
      },
      list: async (requestedPhase?: Phase) => {
        const visibleKeys = await this.resolveVisibleArtifactKeys(baseReader, phase);

        if (!requestedPhase) {
          return visibleKeys;
        }

        return visibleKeys
          .filter((key) => key.startsWith(`${requestedPhase}/`))
          .map((key) => key.split("/", 2)[1] ?? key);
      },
    };
  }

  private async resolveVisibleArtifactKeys(
    artifactReader: ArtifactReader,
    phase: Phase,
  ): Promise<string[]> {
    const allKeys = await artifactReader.list();

    if (phase === "clarify") {
      return allKeys
        .filter((key) => key.startsWith("clarify/"))
        .sort();
    }

    const previousPhase = this.getPreviousPhaseConfig(phase);

    if (!previousPhase) {
      return [];
    }

    if (previousPhase.name === "clarify") {
      const finalArtifactKey = `clarify/${resolveFinalArtifactDefinition("clarify", previousPhase.hostRole).key}`;

      return allKeys.includes(finalArtifactKey) ? [finalArtifactKey] : [];
    }

    const finalArtifactKey = `${previousPhase.name}/${resolveFinalArtifactDefinition(previousPhase.name, previousPhase.hostRole).key}`;
    const previousPhaseKeys = allKeys
      .filter((key) => key.startsWith(`${previousPhase.name}/`))
      .sort();

    if (previousPhaseKeys.includes(finalArtifactKey)) {
      return [finalArtifactKey];
    }

    return previousPhaseKeys.length > 0 ? [previousPhaseKeys[0]] : [];
  }

  private resolveClarifyDecision(
    roleResult: RoleResult,
  ): "ask_next_question" | "ready_for_prd" {
    const decision = roleResult.metadata?.decision;

    if (
      decision !== "ask_next_question" &&
      decision !== "ready_for_prd"
    ) {
      throw new Error(
        "Clarify role must return metadata.decision as ask_next_question or ready_for_prd.",
      );
    }

    return decision;
  }

  private async saveNamedArtifact(
    workflowEvents: WorkflowEvent[],
    phaseConfig: WorkflowPhaseConfig,
    artifactKey: string,
    artifactTitle: string,
    content: string,
  ): Promise<void> {
    const artifactPath = await this.dependencies.artifactManager.saveArtifact(
      this.dependencies.taskState.taskId,
      {
        key: artifactKey,
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        title: artifactTitle,
        content,
      },
    );

    await this.pushEvent(
      workflowEvents,
      "artifact_created",
      `阶段 ${phaseConfig.name} 的工件 ${artifactKey} 已创建。`,
      {
        phase: phaseConfig.name,
        roleName: phaseConfig.hostRole,
        artifactKey,
        artifactPath,
      },
    );
  }

  private resolveRunStartPhase(): WorkflowPhaseConfig {
    if (this.dependencies.taskState.phaseStatus === "done") {
      // 任务已经做完当前 phase 时，run 会直接跳到下一个 phase，
      // 兼容从已初始化快照继续启动的场景。
      return (
        this.getNextPhaseConfig(this.dependencies.taskState.currentPhase) ??
        this.getPhaseConfig(this.dependencies.taskState.currentPhase)
      );
    }

    return this.getPhaseConfig(this.dependencies.taskState.currentPhase);
  }

  private resolveResumePhase(): WorkflowPhaseConfig {
    const resumePoint = this.dependencies.taskState.resumeFrom;

    if (resumePoint) {
      // 恢复优先信任持久化的恢复点，而不是依赖当前内存里的推断状态。
      return this.getPhaseConfig(resumePoint.phase);
    }

    if (this.dependencies.taskState.phaseStatus === "done") {
      return (
        this.getNextPhaseConfig(this.dependencies.taskState.currentPhase) ??
        this.getPhaseConfig(this.dependencies.taskState.currentPhase)
      );
    }

    return this.getPhaseConfig(this.dependencies.taskState.currentPhase);
  }

  private getPhaseConfig(phase: Phase): WorkflowPhaseConfig {
    const phaseConfig = this.dependencies.projectConfig.workflowPhases.find(
      (item) => item.name === phase,
    );

    if (!phaseConfig) {
      throw new Error(`Workflow phase is not configured: ${phase}`);
    }

    return phaseConfig;
  }

  private getNextPhaseConfig(phase: Phase): WorkflowPhaseConfig | undefined {
    const phases = this.dependencies.projectConfig.workflowPhases;
    const currentIndex = phases.findIndex((item) => item.name === phase);

    if (currentIndex === -1) {
      throw new Error(`Workflow phase is not configured: ${phase}`);
    }

    return phases[currentIndex + 1];
  }

  private getPreviousPhaseConfig(phase: Phase): WorkflowPhaseConfig | undefined {
    const phases = this.dependencies.projectConfig.workflowPhases;
    const currentIndex = phases.findIndex((item) => item.name === phase);

    if (currentIndex <= 0) {
      return undefined;
    }

    return phases[currentIndex - 1];
  }

  private async pushEvent(
    workflowEvents: WorkflowEvent[],
    type: WorkflowEventType,
    message: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // 事件的追加、落日志、广播必须保持同序，
    // 这样 CLI 展示和磁盘日志能对齐同一条状态变更。
    const event = this.createWorkflowEvent(type, message, metadata);
    workflowEvents.push(event);
    await this.dependencies.eventLogger.append(event);
    this.dependencies.eventEmitter.emit("workflow_event", event);
  }

  private async saveSnapshot(reason: string): Promise<void> {
    // 每次关键状态变化都同时刷新 TaskState 和持久化上下文，
    // 保证下次恢复看到的是同一轮执行留下的磁盘状态。
    await this.dependencies.artifactManager.saveTaskState(this.dependencies.taskState);
    await this.syncPersistedContext();
    this.dependencies.eventEmitter.emit("workflow_snapshot", {
      taskId: this.dependencies.taskState.taskId,
      reason,
    });
  }

  private async saveLatestInput(input?: string): Promise<void> {
    if (!this.hasUsableInput(input)) {
      return;
    }

    const context = await this.loadTaskContextSafe();

    if (!context) {
      return;
    }

    context.latestInput = input?.trim();
    await this.dependencies.artifactManager.saveTaskContext(context);
  }

  private async syncPersistedContext(): Promise<void> {
    const context = await this.loadTaskContextSafe();

    if (!context) {
      return;
    }

    await this.dependencies.artifactManager.saveTaskContext(context);
  }

  private async loadTaskContextSafe() {
    try {
      return await this.dependencies.artifactManager.loadTaskContext(
        this.dependencies.taskState.taskId,
      );
    } catch {
      return null;
    }
  }

  private async failWithError(
    error: unknown,
    message: string,
    existingEvents: WorkflowEvent[] = [],
  ): Promise<WorkflowEvent[]> {
    const workflowEvents = existingEvents;
    const currentPhaseConfig = this.getCurrentPhaseConfigSafe();

    this.dependencies.taskState.status = TaskStatus.FAILED;
    this.dependencies.taskState.phaseStatus = this.getTerminalPhaseStatus();
    if (currentPhaseConfig) {
      this.dependencies.taskState.resumeFrom = {
        phase: this.dependencies.taskState.currentPhase,
        roleName: currentPhaseConfig.hostRole,
        currentStep: "failed",
      };
    }
    this.touchTaskState();

    await this.pushEvent(workflowEvents, "error", message, {
      error: error instanceof Error ? error.message : String(error),
      phase: this.dependencies.taskState.currentPhase,
      roleName: currentPhaseConfig?.hostRole,
      status: TaskStatus.FAILED,
    });
    await this.pushEvent(workflowEvents, "task_end", "任务执行失败。", {
      status: TaskStatus.FAILED,
    });
    await this.saveSnapshot("task_failed");
    return workflowEvents;
  }

  private getCurrentPhaseConfigSafe(): WorkflowPhaseConfig | null {
    return (
      this.dependencies.projectConfig.workflowPhases.find(
        (phase) => phase.name === this.dependencies.taskState.currentPhase,
      ) ?? null
    );
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
      taskState: this.cloneTaskState(),
      metadata,
    };
  }

  private cloneTaskState(): TaskState {
    return JSON.parse(JSON.stringify(this.dependencies.taskState)) as TaskState;
  }

  private touchTaskState(): void {
    this.dependencies.taskState.updatedAt = Date.now();
  }

  private hasUsableInput(input?: string): boolean {
    return Boolean(input && input.trim().length > 0);
  }

  private shouldUseResumeInput(
    previousStatus: TaskStatus,
    consumeInputForPhase: boolean,
    resumePoint?: TaskState["resumeFrom"],
  ): boolean {
    if (!consumeInputForPhase) {
      return false;
    }

    if (previousStatus === TaskStatus.WAITING_APPROVAL) {
      return false;
    }

    return resumePoint?.currentStep !== undefined;
  }

  private shouldCompleteAfterFinalApproval(
    resumePoint?: TaskState["resumeFrom"],
  ): boolean {
    return (
      this.dependencies.taskState.phaseStatus === "done" &&
      !this.getNextPhaseConfigSafe(this.dependencies.taskState.currentPhase) &&
      resumePoint?.phase === this.dependencies.taskState.currentPhase &&
      resumePoint?.currentStep?.startsWith("waiting_final_approval_after_") === true
    );
  }

  private getTerminalPhaseStatus(): "pending" | "done" {
    return this.dependencies.taskState.phaseStatus === "done" ? "done" : "pending";
  }

  private isTerminalStatus(): boolean {
    return (
      this.dependencies.taskState.status === TaskStatus.COMPLETED ||
      this.dependencies.taskState.status === TaskStatus.FAILED
    );
  }

  private assertTaskId(taskId: string): void {
    if (taskId !== this.dependencies.taskState.taskId) {
      throw new Error(`Task id mismatch: ${taskId}`);
    }
  }

  private getNextPhaseConfigSafe(
    phase: Phase,
  ): WorkflowPhaseConfig | undefined {
    try {
      return this.getNextPhaseConfig(phase);
    } catch {
      return undefined;
    }
  }
}

function createArtifactKey(
  phase: Phase,
  roleName: RoleName,
  artifactIndex: number,
): string {
  return createGenericArtifactKey(phase, roleName, artifactIndex);
}

function createArtifactTitle(
  phase: Phase,
  roleName: RoleName,
  artifactIndex: number,
): string {
  return `${phase}-${roleName}-${artifactIndex + 1}`;
}

function buildInitialRequirementArtifact(input: string): string {
  return ["# Initial Requirement", "", input.trim()].join("\n");
}

function appendClarifyDialogueQuestion(
  existingContent: string,
  question: string,
): string {
  const round = nextClarifyDialogueRound(existingContent);
  const prefix =
    existingContent.trim().length > 0 ? `${existingContent.trim()}\n\n` : "# Clarify Dialogue\n\n";

  return [
    prefix,
    `## Round ${String(round)} Question`,
    "",
    question.trim(),
  ].join("\n");
}

function appendClarifyDialogueAnswer(
  existingContent: string,
  answer: string,
): string {
  const trimmed = existingContent.trim();
  const round = currentClarifyDialogueRound(trimmed);

  if (trimmed.length === 0 || round === 0) {
    return [
      "# Clarify Dialogue",
      "",
      "## Round 1 Answer",
      "",
      answer.trim(),
    ].join("\n");
  }

  return [
    trimmed,
    "",
    `## Round ${String(round)} Answer`,
    "",
    answer.trim(),
  ].join("\n");
}

function currentClarifyDialogueRound(content: string): number {
  const matches = [...content.matchAll(/## Round (\d+) Question/g)];
  const lastMatch = matches.at(-1);

  if (!lastMatch) {
    return 0;
  }

  return Number(lastMatch[1]);
}

function nextClarifyDialogueRound(content: string): number {
  return currentClarifyDialogueRound(content) + 1;
}

function buildClarifyFinalPrdInput(): string {
  return [
    "请基于当前 clarify 阶段可见的 initial requirement 与 clarify dialogue 工件，",
    "生成最终 PRD 工件内容。",
    "这次调用的目标是正式生成 PRD，而不是继续提问。",
  ].join("\n");
}

function matchVisibleArtifactKey(
  key: string,
  visibleKeys: string[],
): string | undefined {
  if (visibleKeys.includes(key)) {
    return key;
  }

  return visibleKeys.find((visibleKey) => visibleKey.endsWith(`/${key}`));
}

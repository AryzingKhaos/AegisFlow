# AegisFlow
AegisFlow 是一个面向真实软件开发工作的 Agentic Dev Workflow System。  
它的目标不是单纯生成代码，而是把需求澄清、代码探索、计划拆解、实现、审查、测试建议等环节组织成一条可控的开发流程。  
AegisFlow 优先服务于 brownfield 项目，即已有代码库、已有架构、已有历史包袱的真实工程场景。  
## 1. 项目目标（Project Purpose）

AegisFlow 的目标是构建一个可长期使用的 AI 开发助理系统，用于辅助日常真实开发工作，而不是只做一次性 demo。

它希望解决的核心问题包括：

- 需求描述不清晰，直接进入编码容易返工
- 陌生项目和历史代码阅读成本高
- AI 虽然能生成代码，但缺少足够上下文时容易乱改
- 开发速度提升后，review、自测、回归验证仍然是瓶颈
- 多轮 AI 对话中的上下文容易污染，信息难以稳定传递
- 工程实践中缺少一套可复用、可沉淀的 AI 开发工作流

AegisFlow 通过将开发过程拆解为多个阶段和多个专职角色，使 AI 在每个阶段只处理明确、受约束的任务，并通过工件在阶段之间传递信息，从而提升开发的稳定性、可控性和复用性。

## 2. v0.1版本支持内容（Scope）

支持的工作流（暂定）：
- Feature Change：已有功能点的规则修改、页面适配、联动逻辑调整
- Bugfix：已有问题修复、边界情况修复、回归问题修复
- Small New Feature：较小的新功能点开发

v0.1 不追求：
- 过于复杂的系统
- 全自动提交代码
- 全自动完成所有测试
- 通用支持任意项目
- 一开始就具备复杂 UI 后台
- 替代人工架构判断

## 3.阶段划分与核心角色（Workflow Overview and Core Roles）


AegisFlow 将开发流程拆解为若干阶段：

1. **Clarify**
   - 接收需求
   - 判断任务类型
   - 澄清缺失信息
   - 输出结构化任务描述

2. **Explore**
   - 读取项目上下文、相关代码和知识资料
   - 分析入口、调用链、依赖和影响面
   - 生成 exploration 工件

3. **Plan**
   - 基于 exploration 和项目规范生成 feature spec
   - 产出 implementation plan
   - 明确 acceptance、touch scope、open questions

4. **Build**
   - 根据 plan 实现代码改动
   - 输出改动摘要和 rationale
   - 只在允许的范围内修改代码

5. **Critic**
   - 对实现结果进行 review
   - 检查 spec 与实现的一致性
   - 输出 must-fix / optional issues

6. **Test Design**
   - 生成自测 checklist
   - 生成回归测试建议
   - 标记高风险路径

7. **Archive**（后续增强）
   - 同步和归档工件
   - 更新文档和索引
   - 保持知识库与实际实现一致

8. **Architect**（后续增强）
   - 规划从0到1的项目
   - 专注于架构、types、config的定义
   - 保证基础骨架可控


AegisFlow 当前包含以下核心角色：

- **Clarifier**：澄清需求，生成结构化任务输入
- **Explorer**：理解代码、资料和上下文，输出 exploration
- **Planner**：生成 spec 和 implementation plan
- **Builder**：执行代码改动
- **Critic**：执行审查和风险识别
- **Test Designer**：生成测试点和回归建议
- **Tester**：执行测试阶段任务并输出测试执行结果
- **Test Writer**：编写或修改单元测试及相关测试辅助代码
- **Archivist**（后续）：维护知识和文档一致性
- **Architect**（后续）：架构师，针对从0到1的项目

这些角色不是聊天人格，而是开发流程中的专职执行单元。


## 4. 设计原则（Design Principles）

### 4.1 Artifact-driven
AegisFlow 强调通过工件而不是聊天上下文来传递信息。  
每个阶段的输出都应尽量固定格式、可保存、可审核、可复用。

### 4.2 Human-in-the-loop
AegisFlow 不追求“完全自动化”，而强调关键节点的人工确认。  
在 spec、实现、review 等关键环节保留人工审批能力。
关键的工件需要有json和md两份，md便于人阅读，json是固定格式化的输入和输出

### 4.3 Brownfield-first
AegisFlow 优先适配已有项目、已有历史代码、已有复杂架构的现实开发环境。

### 4.4 Controlled Scope
AegisFlow 要尽量减少 AI 越界修改的风险，因此要求在 planning 阶段明确 touch scope，并在 build 阶段严格遵守。

### 4.5 Readability + Structure
系统内部会优先维护结构化输出，便于 agent 之间传递；  
同时也会生成适合人工审阅的 markdown 工件，方便开发者理解和确认。
## 5.项目架构
架构图：
```mermaid
flowchart LR
   U[用户输入需求]
   R[Runtime（存放在内存中）]
   F[文件系统]
   CODE[真实代码]
   L1[Intake 层,是Agent,判断任务类型,选择workflow,获取用户输入,展示workflow的消息,UI层]
   L2[Workflow 层，实例 WorkflowController。phase是workflow的内置状态之一]
   L3[Role层，通过 RoleRegister 管理角色，都是Agent，根据Phase确定主持人。本期只有主持人，没有其他角色]
   Role1[Clarifier]
   Role2[Explorer]
   Role3[Planner]
   Role4[Builder]
   Role5[Critic]
   Role6[TestDesigner]
   Role7[Tester]
   Role8[TestWriter]

   R -->|TaskState、EventEmitter| L1
   R -->|ArtifactManager、EventEmitter、EventLogger、ProjectConfig| L2
   R -->|RoleRegistry| L3

   U --> L1
   L1 -->|IntakeEvent| L2
   L2 -->|WorkflowEvent / role_output| L1
   L2 -->|直接调用| L3

   L3 -->|角色执行结果 / 增量可见输出| L2
   L2 -->|artifact工件| F

   L2 -->|用户需求| L3
   L3 -->|执行澄清任务| Role1
   Role1 -->|artifact完整澄清的用户需求| L2
   L2 -->|artifact完整澄清的用户需求| L3
   L3 -->|执行探索任务| Role2
   Role2 -->|artifact根据需求解释相关代码| L2
   L2 -->|artifact完整澄清的用户需求 + artifact根据需求解释相关代码| L3
   L3 -->|执行规划任务| Role3
   Role3 -->|artifact计划文档| L2
   L2 -->|artifact计划文档| L3
   L3 -->|执行实现任务| Role4
   Role4 -->|修改代码| CODE
   Role4 -->|artifact修改代码总结| L2
   L2 -->|artifact修改代码总结 + git修改区内容| L3
   L3 -->|执行审查任务| Role5
   Role5 -->|artifact代码review报告| L2
   L2 -->|artifact修改代码总结 + git修改区内容| L3
   L3 -->|执行测试设计任务| Role6
   Role6 -->|artifact代码修改测试建议| L2
   L2 -->|artifact修改代码总结 + git修改区内容| L3
   L3 -->|执行测试任务| Role7
   Role7 -->|artifact测试执行结果| L2
   L2 -->|artifact修改代码总结 + git修改区内容| L3
   L3 -->|执行单测编写任务| Role8
   Role8 -->|添加/修改单元测试| CODE
   Role8 -->|artifact代码单元测试| L2
```


主流程时序图：
```mermaid
sequenceDiagram
  participant U as 用户
  participant IA as IntakeAgent
  participant WF as Workflow
  participant RRT as RoleRuntime
  participant RR as RoleRegistry
  participant RD as RoleDefinition
  participant R as Role
  participant AM as ArtifactManager
  participant CODE as 代码库

  U->>IA: 输入需求
  IA->>WF: run(task)

  WF->>WF: status = RUNNING

  %% CLARIFY
  WF->>RR: get(clarifier)
  alt 未注册
    WF->>RR: register(roleDef)
    WF->>RRT: 构造 RoleRuntime
    RR->>RD: create(roleRuntime)
    RD-->>RR: role
  end
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  %% EXPLORE
  WF->>RR: get(explorer)
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  %% PLAN
  WF->>RR: get(planner)
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  %% 中断
  WF->>WF: status = WAITING_APPROVAL
  WF->>WF: resumeFrom = PLAN

  U->>IA: 用户确认
  IA->>WF: resume(task)

  %% 恢复（重跑整个 phase）
  WF->>RR: get(planner)
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  %% BUILD
  WF->>RR: get(builder)
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R->>CODE: 修改代码
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  %% REVIEW
  WF->>RR: get(critic)
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  %% TEST DESIGN
  WF->>RR: get(test-designer)
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  %% TEST
  WF->>RR: get(tester)
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  %% UNIT TEST
  WF->>RR: get(test-writer)
  RR-->>WF: role
  WF->>R: run(input, ExecutionContext)
  loop 角色持续执行
    R-->>WF: 用户可见增量输出
    WF-->>IA: WorkflowEvent(role_output)
    IA-->>U: 格式化后实时展示
  end
  R->>CODE: 添加/修改单元测试
  R-->>WF: RoleResult
  WF->>AM: 保存 artifact

  WF->>WF: status = COMPLETED
```

## 6.主要对象

#### Runtime
 - Runtime 对象仅存在于内存中。部分内容比如 taskState 的快照会被保存到md中
 - Runtime 对象初始化时应该初始化如下实例： TaskState 、WorkflowController 、 ProjectConfig 、 EventEmitter 、 EventLogger 、 ArtifactManager 、 RoleRegistry
 - Runtime 对象在Intake刚开始就需要初始化，需要的资料包括：目标项目目录、workflow具体流程编排、工件保存目录
 - Runtime 对象在任务恢复时必须重新创建，



```typescript
interface Runtime {
   taskState: TaskState;
   workflow: WorkflowController;
   projectConfig: ProjectConfig;
   eventEmitter: EventEmitter; // todos
   eventLogger: EventLogger; // todos
   artifactManager: ArtifactManager; // todos
   roleRegistry: RoleRegistry; // todos
}

// 传给 RoleDefinition 的受限运行时视图，用于避免把 Workflow 内部状态机直接暴露给角色
interface RoleRuntime {
   projectConfig: ProjectConfig;
   eventEmitter: EventEmitter; // todos
   eventLogger: EventLogger; // todos
   roleRegistry: RoleRegistry; // todos
}

// 这是本项目的主要状态机
interface TaskState {
  taskId: string; // 任务ID，比如‘task_20260323_001-[title]’
  title: string; // 任务标题，英文，使用“_”相连，比如“create_base_code”
  currentPhase: Phase;
  phaseStatus: PhaseStatus;
  status: TaskStatus;
  resumeFrom?: { // 如果是从中断中恢复的，需要此字段
     phase: Phase;
     roleName: string;
     currentStep?: string; // 执行到的步骤的大致描述
  };
  updatedAt: number; // timestamp
}

export enum TaskStatus {
  IDLE = "idle",
  RUNNING = "running",
  WAITING_USER_INPUT = "waiting_user_input",
  WAITING_APPROVAL = "waiting_approval",
  INTERRUPTED = "interrupted",
  FAILED = "failed",
  COMPLETED = "completed",
}

export enum Phase {
   CLARIFY = 'clarify',
   EXPLORE = 'explore',
   PLAN = 'plan',
   BUILD = 'build',
   REVIEW = 'review',
   TEST_DESIGN = 'test-design',
   UNIT_TEST = 'unit-test',
   TEST = 'test',
}

export enum PhaseStatus {
   PENDING = 'pending',
   RUNNING = 'running',
   DONE = 'done',
}

// 主要是从 .aegisflow/aegisproject.yaml 中读取的内容
interface ProjectConfig {
   cwd: string; // 目标项目地址
   artifactPath: string; // 输出artifact的根目录
   targetProjectRolePromptPath: string; // 目标项目角色提示词目录加载后的内存值，等价于 roles.promptDir；默认按严格同名文件读取 planner.md、builder.md、critic.md 等。若 roles.overrides.*.extraInstructions 已配置，则优先使用 override 指向的文件；与角色原型文档按追加方式组装，冲突时项目侧职责优先，缺失时回退到角色原型文档
   workflowPhases: Phase[]; // workflow阶段的配置，v0.1版本可以先写死
}

// 用于管理所有角色，是一个角色工厂。workflow用到角色的时候从工厂里获取，如果没有再重新注册
interface RoleRegistry {
   register: (roleDef: RoleDefinition) => void;
   get: (name: string) => Role;
   list(): string[];
}

// 角色蓝图，也就是角色职责
interface RoleDefinition {
  name: string;
  description?: string;
  create: (runtime: RoleRuntime) => Role;
}

// 具体的、实例化的角色
interface Role {
   name: string;
   run(input: any, context: ExecutionContext): Promise<RoleResult>
}

// Role 返回的结构化结果
interface RoleResult {
  summary: string;
  artifacts: string[]; // 每个元素都是可直接写入 md 文件的工件内容
  metadata?: Record<string, any>;
}

// 提供给 Role 层的只读工件视图，避免角色直接接触 ArtifactManager
interface ArtifactReader {
  get(key: string): Promise<string | undefined>;
  list(phase?: Phase): Promise<string[]>;
}

// 角色运行时的上下文，主要是只读工具和必要的记录
interface ExecutionContext {
  taskId: string;
  phase: Phase;
  cwd: string;
  artifacts: ArtifactReader;
  projectConfig: ProjectConfig;
}
```

#### Intake层
Intake本身是一个Agent，所以对象应该叫 IntakeAgent？
 - 是一个UI层 + 轻决策层
 - 第一次跟用户沟通，主要目的是补齐runtime初始化需要的资料，唯一需要做决策的内容是选择具体的 workflow。
 - 没有具体的命令，只要用户描述了内容，就要根据用户描述的内容猜测用户想干什么，并询问用户“是不是想要XXX”
 - intake目前提供的能力
	 - 创建任务，并描述
	 - 开始任务
	 - 取消任务
	 - 中断任务（支持control + C中断任务）
	 - 继续未完成的任务
	 - 对任务的内容进行补充
 - 负责跟用户沟通，将用户的需求规范化传给workflow
 - 接收workflow层的消息，实时展示到CLI上
 - 对展示到 CLI 的文本做基础排版，至少支持换行、段落、列表和代码块边界
 - 初始化Runtime对象
 - 给 workflow 发送 IntakeEvent，接收 workflow 的 WorkflowEvent

```typescript
// todos：需要转换成枚举类型
type IntakeEventType =
  | "init_task"
  | "start_task"
  | "cancel_task"
  | "interrupt_task"
  | "resume_task"
  | "participate"

// intake 层向 Workflow 层发送通知，使用 IntakeEvent
// todos metadata
type IntakeEvent = {
  type: IntakeEventType;
  taskId: string;
  message: string; // 应该只作为log记录用
  timestamp: number;
  metadata?: { // 应该只作为log记录用
    phase?: string;
    role?: string;
    artifactPath?: string;
  };
}
```

#### Workflow层
对象应该叫 WorkflowController ，编排与流水线推进，是整个系统的核心，
 - 驱动 TaskState 状态机（phase 流转 + 中断恢复）
 - 不是Agent。
 - 唯一的 Runtime.TaskState 的合法修改者，并保存 TaskState 的快照到md文件里，保证进程被打断的时候，下一次启动可以直接继续上一次的任务
 - 接收 intake 层的指令。准确地说，是接收 TaskStatus 变更的指令，然后将 intake 层的用户要求透传给 role 层的具体 agent。
 - 接收 role 层返回的最终结果，调用 ArtifactManager ，写工件
 - 在角色执行过程中，承担 Role 用户可见增量输出到 Intake 的统一转发职责
 - 写 EventLogger 日志
 - 更新 TaskStatus 状态
 - 从 intake 层接受 IntakeEvent，给 intake 层发送 WorkflowEvent
 - 直接调用 role

```typescript

interface WorkflowController {
   run(taskId: string): Promise<void>;
   resume(taskId: string, input?: any): Promise<void>; // input是额外的用户补充内容?
   runPhase(phase: PhaseConfig): Promise<void>; // PhaseConfig是什么没想好。
   runRole(roleName: string, input: any): Promise<RoleResult>;
}

// todos: WorkflowEventType 应该转变为枚举
type WorkflowEventType =
  | "task_start"
  | "task_end"
  | "phase_start"
  | "phase_end"
  | "role_start"
  | "role_end"
  | "role_output"
  | "artifact_created"
  | "progress"
  | "error"

type WorkflowEvent = {
  type: WorkflowEventType
  taskId: string
  message: string // 对于 role_output / progress 等展示型事件，允许携带多行用户可见文本
  timestamp: number
  metadata?: {
    phase?: string
    role?: string
    artifactPath?: string
    outputKind?: "status" | "role_output" | "summary"
  }
}

type EventListener = (event: WorkflowEvent | IntakeEvent) => void
interface EventEmitter {
  emit(event: WorkflowEvent): void
  subscribe(listener: EventListener): () => void
}

interface EventLogger {
  log(event: LogEvent): void
}

// LogEvent 很自由，用于记录发生的一切
type LogEvent = {
  type: string;
  taskId?: string;
  message: string;
  timestamp: number;
  level?: "debug" | "info" | "warn" | "error"; // todos: 应当改成enum
  metadata?: Record<string, any>
}
```

#### Role层
 - 都是agent
 - 接受workflow层的指令，执行任务。
 - 副作用，比如修改代码、修改单测
 - 执行过程中可以产生用户可见的增量输出，但不能直接写 CLI，必须通过 Workflow 转发
 - 返回执行任务的最终结果，但不包含写工件的工作


## 7.配置文件示例
.aegisflow/aegisproject.yaml 文件示例：
```yaml
project:
  name: "project-name"
  description: "描述你的项目"

paths:
  cwd: "/Users/aaron/code/projectpath"
  artifactDir: ".aegisflow/artifacts"
  snapshotDir: ".aegisflow/state"
  logDir: ".aegisflow/logs"
  requirementDocs: "docs/requirements"  # 项目需求文档目录
  knowledgeBase: ".aegisflow/knowledge"    # 项目知识库路径（加载方式以后再定）
 
codeStyle:
  # eslintConfig: ".eslintrc.json"
  # prettierConfig: ".prettierrc"
  archOverview: "docs/architecture.md"       # 项目架构说明
  unitTestRules: "docs/unit_test_rules.md"   # 单测规范
  codeReviewGuide: "docs/code_review.md"     # review注意事项

workflow:
  type: "default-workflow" # 预留：未来支持多 workflow
  phases:
    - name: "clarify"
      hostRole: "clarifier"
	  needApproval: true

    - name: "explore"
      hostRole: "explorer"
	  needApproval: true

    - name: "plan"
      hostRole: "planner"
      needApproval: true

    - name: "build"
      hostRole: "builder"
	  needApproval: true

    - name: "review"
      hostRole: "critic"
	  needApproval: true

    - name: "test"
      hostRole: "tester"
	  needApproval: true

roles:
  prototypeDir: "/Users/aaron/code/roleflow/roles" # 角色原型目录
  promptDir: ".aegisflow/roles" # AegisFlow 项目级角色提示词目录
  # overrides:
  #   critic:
  #     extraInstructions: ".aegisflow/roles/custom-critic.md"

artifacts:
  structure: "by-phase" # by-phase / flat
  format: "md"

  types:
    clarify: "clarification.md"
    explore: "exploration.md"
    plan: "plan.md"
    review: "review.md"
    test: "test.md"

runtime:
  maxRetries: 2
  timeoutMs: 300000
  interrupt:
    allowUserInput: true
    allowAbort: true

logging:
  level: "info" # debug / info / warn / error
  saveToFile: true
```

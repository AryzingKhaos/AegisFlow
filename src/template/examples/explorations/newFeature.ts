import { NewFeatureExplorationTemplate } from "../../models";

export const newFeatureExplorationTemplate = new NewFeatureExplorationTemplate(
  {
    text: "Exploration: New Feature",
    key: "explorationNewFeature",
  },
  "roleflow/templates/explorerations/newFeature.md",
  [
    // 请用 3～5 行说明：
    // - 这个需求要做什么
    // - 这个功能服务谁
    // - 当前项目里是否已有类似能力
    // - 当前最大的未知点是什么
    {
      heading: {
        text: "概述",
        key: "summary",
      },
      format: "mixed",
      body: ``,
    },

    // 整理原始需求，回答：
    // - 功能目标是什么
    // - 用户最终能得到什么
    // - 明确不包含哪些内容
    // - 当前已知限制有哪些
    {
      heading: {
        text: "需求摘要",
        key: "requirementSummary",
      },
      format: "mixed",
      body: ``,
    },

    // 列出项目内可能可以复用的能力：
    // - 已有页面
    // - 已有组件
    // - 已有 hooks / utils / service
    // - 已有类似业务逻辑
    // - 已有状态管理逻辑
    {
      heading: {
        text: "现有可复用能力",
        key: "reusableCapabilities",
      },
      format: "mixed",
      body: ``,
    },

    // 优先用 Mermaid 流程图列出这个功能可能从哪里接入：
    //
    // ```mermaid
    // flowchart LR
    //     A[页面入口] --> E[新功能]
    //     B[路由入口] --> E
    //     C[模块入口] --> E
    //     D[按钮 / 事件 / 配置开关] --> E
    // ```
    {
      heading: {
        text: "可能的入口点",
        key: "possibleEntryPoints",
      },
      format: "mixed",
      body: ``,
    },

    // 列出与本功能最相关的模块，并说明它们当前作用：
    // - 模块 A：作用
    // - 模块 B：作用
    // - 模块 C：作用
    {
      heading: {
        text: "相关模块",
        key: "relatedModules",
      },
      format: "mixed",
      body: ``,
    },

    // 优先用 Mermaid 流程图列出这个功能可能依赖的内容：
    //
    // ```mermaid
    // flowchart LR
    //     A[redux / store] --> F[新功能]
    //     B[本地存储] --> F
    //     C[后端接口] --> F
    //     D[链上数据] --> F
    //     E[账户 / 网络 / 配置] --> F
    // ```
    {
      heading: {
        text: "数据与状态依赖",
        key: "dataAndStateDependencies",
      },
      format: "mixed",
      body: ``,
    },

    // 如果本功能依赖外部知识，请列出：
    // - 协议
    // - 产品文档
    // - 第三方实现
    // - 历史需求
    // - 参考页面
    {
      heading: {
        text: "外部参考资料",
        key: "externalReferences",
      },
      format: "mixed",
      body: ``,
    },

    // 优先用 Mermaid 流程图展示风险扩散关系，再补充文字说明：
    //
    // ```mermaid
    // flowchart TD
    //     A[新功能实现] --> B[架构风险]
    //     A --> C[历史兼容风险]
    //     A --> D[状态联动风险]
    //     A --> E[性能风险]
    //     A --> F[测试风险]
    // ```
    {
      heading: {
        text: "潜在风险",
        key: "potentialRisks",
      },
      format: "mixed",
      body: ``,
    },

    // 列出当前不能擅自假设的问题：
    // - 问题 1
    // - 问题 2
    // - 问题 3
    {
      heading: {
        text: "待确认问题",
        key: "openQuestions",
      },
      format: "mixed",
      body: ``,
    },

    // 三选一：
    // - 可以进入 Planner
    // - 可以进入 Planner，但需要保留 open questions
    // - 暂时不能进入 Planner，必须先补充上下文
    {
      heading: {
        text: "当前探索结论",
        key: "currentExplorationConclusion",
      },
      format: "mixed",
      body: ``,
    }
  ],
);

export default newFeatureExplorationTemplate;

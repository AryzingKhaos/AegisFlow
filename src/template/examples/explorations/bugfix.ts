import { BugFixExplorationTemplate } from "../../models";

export const bugFixExplorationTemplate = new BugFixExplorationTemplate(
  {
    text: "Exploration: Bug Fix",
    key: "explorationBugFix",
  },
  "roleflow/templates/explorerations/bugfix.md",
  [
    // 请用 3～5 行说明：
    // - 当前 bug 现象是什么
    // - 影响范围大概是什么
    // - 初步怀疑问题出在哪
    // - 当前最大的未知点是什么
    {
      heading: {
        text: "概述",
        key: "summary",
      },
      format: "mixed",
      body: ``,
    },

    // 整理原始 bug 信息：
    // - 用户看到的现象是什么
    // - 预期行为是什么
    // - 实际行为是什么
    // - 是否稳定复现
    // - 是否和特定环境 / 账户 / 网络有关
    {
      heading: {
        text: "问题描述",
        key: "problemDescription",
      },
      format: "mixed",
      body: ``,
    },

    // 优先用 Mermaid 流程图展示复现路径；只有路径极短时才退回列表：
    //
    // ```mermaid
    // flowchart TD
    //     A[进入页面 / 场景] --> B[执行操作 1]
    //     B --> C{是否满足特定条件}
    //     C -- 是 --> D[执行操作 2]
    //     C -- 否 --> E[走另一条分支]
    //     D --> F[出现 bug 现象]
    //     E --> F
    // ```
    //
    // 如果复现条件不完整，也要写清楚缺什么。
    {
      heading: {
        text: "复现路径",
        key: "reproductionPath",
      },
      format: "mixed",
      body: ``,
    },

    // 列出这次 bug 最可能相关的入口：
    // - 页面入口
    // - 按钮 / 事件入口
    // - 请求入口
    // - 状态更新入口
    {
      heading: {
        text: "相关入口点",
        key: "relatedEntryPoints",
      },
      format: "mixed",
      body: ``,
    },

    // 优先用 Mermaid 流程图展示最相关的调用链或逻辑路径：
    //
    // ```mermaid
    // flowchart LR
    //     A[入口] --> B[状态判断]
    //     B --> C[请求 / 逻辑处理]
    //     C --> D[结果展示]
    //     C --> E[异常处理]
    //     E --> F[fallback]
    //     F --> D
    // ```
    {
      heading: {
        text: "关键逻辑链路",
        key: "keyLogicFlow",
      },
      format: "mixed",
      body: ``,
    },

    // 列出最可疑或最相关的模块：
    // - 模块 A：当前作用
    // - 模块 B：当前作用
    // - 模块 C：当前作用
    {
      heading: {
        text: "相关模块",
        key: "relatedModules",
      },
      format: "mixed",
      body: ``,
    },

    // 列出当前怀疑的原因：
    // - 状态未更新
    // - 条件判断错误
    // - 异步时序问题
    // - 空值 / 边界处理遗漏
    // - 历史兼容逻辑冲突
    // - 回归改动影响
    {
      heading: {
        text: "可能根因",
        key: "possibleRootCauses",
      },
      format: "mixed",
      body: ``,
    },

    // 除了当前 bug，本次修复理论上可能波及：
    // - 哪些页面
    // - 哪些共用逻辑
    // - 哪些状态流
    // - 哪些历史行为
    {
      heading: {
        text: "影响面",
        key: "impactScope",
      },
      format: "mixed",
      body: ``,
    },

    // - 修复当前问题但引入新回归
    // - 影响其他分支逻辑
    // - 影响共享状态
    // - 误判根因导致修错位置
    {
      heading: {
        text: "风险点",
        key: "risks",
      },
      format: "bulletList",
      body: ``,
    },

    // - 问题 1
    // - 问题 2
    // - 问题 3
    {
      heading: {
        text: "待确认问题",
        key: "openQuestions",
      },
      format: "bulletList",
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

export default bugFixExplorationTemplate;

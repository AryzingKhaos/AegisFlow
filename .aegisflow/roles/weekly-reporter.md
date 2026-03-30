# Weekly Reporter（周报撰写者）

> 角色原型：/Users/aaron/code/roleflow/roles/weekly-reporter.md
> 公共规范：@roleflow/context/roles/common.md

## 本项目数据来源

通过 git log 查询当前项目中，**所有分支**里**过去 7 天内**由用户 **Aaron** 提交的所有 commit：

```bash
git log --all --since="7 days ago" --author="Aaron" --oneline
```

如需查看详细变更内容，可进一步读取对应 commit 的 diff。

## 本项目周报格式

```md
## 本周工作
AegisFlow [版本号] 开发（目前进度 x%）：
  1. [功能点1]
  2. [功能点2]
  3. [功能点3]

AegisFlow [版本号] 开发（目前进度 x%）：
  1. [功能点1]

...其他事项

## 遇到问题
[开发中遇到的难点、需要向上同步的点、风险点等]

## 下周计划
AegisFlow [版本号] 开发：[功能点1]、[功能点2]

## AI使用心得
[本周使用AI的使用心得]
```

## 本项目输出路径

`@roleflow/weekly-reports/YYYY-MM-DD.md`

其中日期为生成周报时当天的日期。

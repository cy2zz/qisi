# 统一仓库根 AGENTS.md

## What / Why
用户要求任何开发 Agent，无论从 A/B PRD 或其他入口开始，都按同一仓库级规范执行。保留既有 Raven 接入和授权规则，补齐 qisi-3.1 的技术栈、分工、SDD、教学不变量和真实验收边界。

## How / Scope
- 在本仓库根写入 AGENTS.md；两个已有 worktree 同步相同规则，不视为两个项目。
- 旧工作区仍为旧基线时只增加规则和阻断提示，不擅自合并 develop、迁移产品或改用户未提交工作。
- 不修改产品规格包、ZIP、应用、已有 Raven 配置及其他任务。
- 不提交、推送、发布、上传或启动子 Agent。

## Files Changed
- AGENTS.md：统一执行入口。
- ravenspec/changes/root-agent-rules/CHANGE.md：本地变更记录。
- ravenspec/changes/root-agent-rules/verification.json：规则检查与保护文件字节核验记录。

## Workflow status
这是本地文档变更记录，不是已经执行完成的 Raven FastMode 工件。已读取 sdd-fast-change 技能；其 Step 0 要求的 Skill 分发工具不可用，停止该技能流程，按用户授权做本地文档维护。未伪造需求单、Spec Tracker 或远端审查回执；Raven gate=tool_unavailable，独立 review=not_run。

## Verification
- [x] 先对原文件检查：0 项通过、18 项失败（预期缺少新规则）。
- [x] 更新后 18 项规则覆盖通过、0 项失败；两份 AGENTS.md 字节一致。
- [x] qisi-3.1 标准工作区的 22 个规格/脚本引用存在；技术栈与 20 张 A/B 任务字段核对通过。
- [x] 本工作区 237 个原有规格、业务、配置和证据文件字节未改。
- 实际本地基线状态：ready；只核对文档，未执行应用/数据库/模型测试。
- 审查为 self_review；未执行独立 Raven review，不宣称流程全部通过。详细结果见 verification.json。

## 后续 Git 授权（2026-09-16）
用户在文档编写和检查完成后明确要求“推送上去吧”。本轮仅授权提交根 AGENTS.md 及本目录的 CHANGE.md、verification.json，并推送 origin/develop；不包含原工作区其他未提交内容，不涉及 POPO 或生产发布。上文“不提交、推送”及 verification.json 中的 Git 状态保留为文档编写/验证当时的记录，不代表本次后续授权；实际提交与推送以 Git 和远程核对结果为准。

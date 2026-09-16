# qisi-dashboard｜启思AI高中数学思维老师

## 当前决定与实现状态

当前开发规格为 **qisi-3.1，2026-09-16**。设计V6.1、双人约十天开发规划V3.1、PRD V3.1；统一入口qisi-sdd-v3/README.md。

**确定技术栈：Next.js 16 + React 19 + TypeScript + Node.js 24 LTS + Tailwind CSS/shadcn/ui + LangGraph.js Graph API + AI SDK Core + MySQL 8.4 LTS/mysql2。** 配套Zod、Markdown/KaTeX、sharp、Vitest与Playwright。详见qisi-sdd-v3/adr/ADR-001-stack.md及stack.json。

这是选型和SDD规格更新，**不是应用迁移完成**。frontend/仍是React/Vite骨架，backend/仍是Java17/Spring Boot/MyBatis/H2骨架。本次未删除或修改业务代码。A01将在本仓库根建立目标Next.js应用src/，保留现有骨架与数据直到迁移验证完成，不另建应用仓库。

## 目录

- frontend/、backend/：历史应用骨架，不代表新选定技术栈。
- qisi-sdd-v3/：当前qisi-3.1规格；文件名保留v3以维持已有引用。
  - design-v6.md、plan.md、prd.md：设计、双人开发规划、可执行PRD。
  - adr/ADR-001-stack.md、stack.json、runtime.json：选型、职责和预算。
  - tasks.json：A01–A10/B01–B10，A/B均按页面+服务端+持久化+测试交付。
  - contracts/：严格Schema、MySQL DDL、LangGraph与事务边界。
  - acceptance/：60项产品AT + 12项技术ST；含学习效果取证协议。
  - scripts/：规格校验、明确选择的真实MySQL冒烟、打包工具。
  - publication/：历史成功发布证据及当前本地版本状态；不代表本版已同步POPO。
- qisi-sdd-v3.zip：当前本地规格附件，不是应用安装包。
- ravenspec/changes/freeze-mysql84-langgraph-stack/：本次变更范围与实际验证记录。
- research-evidence/：原始方案/调研和来源快照。
- cleanup-report.json：以前目录清理的历史审计，路径描述不代表当前布局。

## 交给开发AI

先读qisi-sdd-v3/AGENTS.md → ADR-001 → stack.json → prd.md → 对应tasks.json/契约/AT/ST/fixture。A从A01，B从B01；单AI按依赖交替，不因产品多Agent自行启动开发子Agent。

A负责全局依赖/配置/MySQL迁移/公共UI/输入/Assessment/报告/历史；B负责ModelPort/AI SDK/LangGraph/saver/其余Agent/教学与教师视图。完整写集以任务卡为准。依赖精确patch和镜像摘要待实际安装后锁定；不得用空测试或fixture冒充真实数据库、模型或学习效果。

## 当前可运行的规格验证

```text
python qisi-sdd-v3/scripts/validate_spec.py
python qisi-sdd-v3/scripts/validate_stack.py
python -m unittest discover -s qisi-sdd-v3/scripts -p test_validate_mysql.py
```

需要Python和qisi-sdd-v3/requirements-dev.txt中的jsonschema。MySQL8.4 DDL实测另见contracts/mysql.md；默认不连接数据库。应用npm命令由A01实现，不能在未完成迁移时宣称已经可以运行新栈。

## POPO和历史基线

本轮仅更新Git并按用户授权推送develop，未重新发布POPO。旧文档设计V6/规划V3/PRD V3及附件仍对应qisi-3.0；最近成功回读记录时间为2026-09-16 11:10:16（Asia/Shanghai），属于历史记录。

publication/live-publication-status.json、publication-verification.json及attachment.json保留不改；本版状态以publication/local-revision-status.json（not_published）为准。旧ZIP/规格可从e54ec4ac6710f94a32af449212b30227aeadb36d取回。不要因为旧记录为published_and_verified而误称qisi-3.1已上线。

主办方题库、模型密钥及部署环境仍需提供。完成原题不等于学会；真实质量以卡点诊断、有效干预、学生自主产物及撤架后新任务表现评估。

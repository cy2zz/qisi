# 启思｜双人约十天多 Agent Web SDD 规格包

当前基线 **qisi-3.1（2026-09-16）**：设计 V6.1、规划 V3.1、PRD V3.1。产品面向高三学生，技术栈已按用户最新决定修订为 React/Vite 前端、NestJS 后端和 MySQL 8.4。

React 19 / TypeScript / Vite / NestJS / Node.js 24.21.0（24 LTS）/ Tailwind CSS / shadcn/ui / LangGraph.js（按需用于有界编排）/ AI SDK Core / MySQL 8.4 + mysql2 + Kysely / Zod / Markdown + KaTeX / sharp / Vitest / Supertest / Playwright。

## 状态与范围

这是规格包，不是已实现应用。全部 20 张任务仍为 planned，60 项产品 AT 与 12 项技术 ST 仍为 specified/not_run；18 条 P0 未删减。当前工作区出现 `web/`、`server/` 迁移内容，但目录存在不等于 React/NestJS 已初始化或验收完成。依赖精确 patch、MySQL 镜像 digest、真实模型和正式题库仍待实测。

此前以根目录全栈框架为目标的路径、命令和服务端接口假设已废止。现行目录是：

- `web/`：React 19 + TypeScript + Vite 前端，PC 优先并完整适配 H5。
- `server/`：NestJS API、worker、模型与工作流、数据库和迁移。
- `qisi-sdd-v3/`：规格、契约与验收。

历史 `publication/`、旧 ZIP 与 POPO 回读证据不会因本地技术栈修订而改写；它们仍只证明历史版本。

## 给开发 AI 的顺序

1. 根 README/AGENTS → 本目录 AGENTS → ADR-001 → stack.json → prd.md。
2. 核对 `web/`、`server/` 的现有未提交内容，不回退或覆盖他人迁移。
3. 从 tasks.json 领取 A01 或 B01；前端路径只写 `web/`，后端、worker、迁移只写 `server/`。
4. 读取 contracts/README.md、mysql.md、workflow-persistence.md、相关 Schema、AT/ST 和 fixtures。
5. 建失败测试 → 纵向实现 React 页面、NestJS API/worker、MySQL 持久化 → 实际验证 → handoff。

A 拥有全局依赖/容器、公共 UI、MySQL 门面和全部迁移，以及题库、媒体、输入、评估、报告与历史；B 拥有模型 I/O、受控工作流、其余 Agent、教学页和教师依据。数据库迁移只有 A 写，AssessmentAgent 业务实现只有 A 写。

## 工作流与恢复决定

MySQL 领域状态是业务事实来源。工作流恢复依赖持久的 run/step、任务租约、模型调用与领域事件；LangGraph checkpoint 仅是可选执行快照，不能替代业务提交、帮助曝光或学习证据。没有真实 conformance、取消、删除和崩溃窗口测试，不采用社区 MySQL saver，也不以 MemorySaver、SQLite 或 mock 冒充恢复能力。

## 文件用途

- design-v6.md / plan.md / prd.md：产品思路、开发规划、任务与验收。
- stack.json / runtime.json / adr/：React/NestJS/MySQL 选型、预算与恢复边界。
- contracts/：严格 Schema、应用边界、MySQL DDL 与一致性协议。
- tasks.json / requirements.json / traceability.csv：20 张任务、18 条需求与 60 项产品 AT 追溯。
- acceptance/stack-cases.json：12 项真实技术门禁；不替代产品 AT。
- reuse.md / reuse-lock.json：候选依赖和待准入证据；不是 npm 安装锁。
- changes/、handoffs/：规格变更与任务交接。

## 规格验证与打包

```text
python3 qisi-sdd-v3/scripts/validate_spec.py
python3 qisi-sdd-v3/scripts/validate_stack.py
python3 -m unittest discover -s qisi-sdd-v3/scripts -p test_validate_mysql.py
```

`validate_spec.py` 会更新报告，`package.py` 会重建 manifest/ZIP；只读核验应在临时副本执行。没有明确发布授权，不运行打包或 POPO 发布脚本。

真实 MySQL DDL 冒烟必须显式许可并使用空的 `qisi_spec_*` 测试库。静态校验不证明 React/NestJS 应用、MySQL 恢复、真实模型能力或学生学会。

## POPO 与外部依赖

qisi-3.1 当前仍为本地未发布修订。旧 POPO 正文、附件和回读证据保留为历史记录，不适用于本地 React/NestJS 技术修订。

题库、模型凭据、MySQL 8.4 和部署环境由项目方提供；缺失时标 `blocked_external`，继续可独立部分。自拟 fixture 不能冒充高考正式题库或真实学生数据。

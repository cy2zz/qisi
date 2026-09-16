# 冻结 MySQL 8.4 / LangGraph 技术栈
日期：2026-09-16。来源：用户本轮明确确认技术栈并授权推送 develop。
本次只更新开发规格，不实现应用、不安装业务依赖、不发布 POPO。
将 qisi-3.0 更新为 qisi-3.1：Next.js 16 / React 19 / TypeScript / Node 24 LTS / Tailwind CSS / shadcn/ui / LangGraph.js Graph API / AI SDK Core / MySQL 8.4 LTS / mysql2 / Zod / sharp / Vitest / Playwright。
保留全部18条P0、20张A/B纵向任务、60项产品AT；新增技术栈门禁，不能替代学习效果验收。
原工作区 develop-B-v1.0 的未提交 Raven 配置不纳入提交；本次在独立 develop 工作树工作。
SDD工具限制：已读 sdd-new-change；当前无该技能要求的 Skill 分发工具，未执行 Raven spec-tracker、遥测或自动门禁。以下为可审计的手工规格变更，不伪造流程完成。
写集：qisi-sdd-v3 当前规格、SQL、校验器、包清单、根README、本变更目录；不改 frontend/ backend/，不改已有 publication 发布回读证据。
风险：实际骨架仍Java/Vite，A01须在原仓库根迁移而非另建qisi-web；LangGraph MySQL saver需实现与真实数据库验证；精确补丁版本待安装锁定。
回滚：通过Git revert本次规格提交，恢复e54ec4a的qisi-3.0；不回滚其他开发者代码或已有在线文档。
验收：新增栈检查先失败后通过；原规范全部校验；MySQL未执行则明确not_run；包hash/独立解压验证；远程develop与本地提交一致。

# 启思｜双人约十天多Agent全栈Web SDD规格包

当前基线 **qisi-3.1（2026-09-16）**：设计V6.1、规划V3.1、PRD V3.1。文件名沿用design-v6.md / plan.md / prd.md，避免断开已有引用。

本版冻结MySQL 8.4 LTS及LangGraph.js Graph API，替代qisi-3.0的SQLite/原生TS编排决定。完整决策见 **adr/ADR-001-stack.md**，机器选型见 **stack.json**。

Next.js 16 / React 19 / TypeScript / Node24 LTS / Tailwind CSS / shadcn/ui / LangGraph.js / AI SDK Core / MySQL8.4+mysql2 / Zod / Markdown+KaTeX / sharp / Vitest / Playwright。

## 状态与范围

这是规格包，不是已实现应用。全部20张任务planned、60项产品AT及12项技术ST specified/not_run；18条P0未删减。现有frontend/backend仍是Java/Vite骨架；依赖未安装、精确patch未锁定。静态校验不证明MySQL DDL已运行、LangGraph恢复、真实模型能力或学生学会。

## 给开发AI的顺序

1. AGENTS.md → adr/ADR-001-stack.md → stack.json → prd.md。
2. 应用位置是qisi-dashboard仓库根，Next.js源码src/、规格qisi-sdd-v3/；不另建同级/嵌套应用。A01按ADR保留并迁移必要旧骨架行为，不直接清目录。
3. tasks.json领取A01或B01；prompts/developer-a.md / developer-b.md / developer-single.md提供启动指令。产品多Agent不是开发子Agent授权。
4. contracts/README.md + mysql.md + workflow-persistence.md；相关Schema、acceptance/cases.json、stack-cases.json、fixture。
5. 建失败测试 → 纵向实现页面/服务端/持久化 → 实际验证 → handoffs。每卡独立检查点，完成后按授权依赖继续。

A拥有全局依赖/迁移/数据库门面/公共UI和输入/评估/历史；B拥有模型I/O/图/saver/教学及其他Agent。数据库迁移只有A写；AssessmentAgent只有A写。A01/B01的共同恢复门禁必须先过，不能D7才首次接真实数据库。

## 文件用途

- design-v6.md / plan.md / prd.md：产品思路、十天里程碑、逐张SDD任务及验收。
- stack.json / runtime.json / adr/：选型、预算、部署与迁移决定。
- contracts/：严格Schema、16个应用边界、MySQL DDL（19表）、持久化一致性协议。
- tasks.json / requirements.json / traceability.csv：20张任务、18条需求与60项产品AT追溯。
- acceptance/stack-cases.json：新增12项真实技术门禁；不替代产品AT。
- reuse.md / reuse-lock.json / evidence/：复用选择和待准入证据。reuse-lock不是npm锁文件。
- changes/、handoffs/：规格变更与实施交接；本次SDD变更见仓库ravenspec/changes/freeze-mysql84-langgraph-stack/。

## 规格验证与打包

```text
python qisi-sdd-v3/scripts/validate_spec.py
python qisi-sdd-v3/scripts/validate_stack.py
python -m unittest discover -s qisi-sdd-v3/scripts -p test_validate_mysql.py
python qisi-sdd-v3/scripts/package.py
```

以上从仓库根执行；Python依赖见requirements-dev.txt。运行validate_spec会更新本地报告，package会重建manifest/ZIP，不能拿这些命令悄悄改写历史发布凭证。

真实MySQL DDL冒烟另执行scripts/validate_mysql.py，默认拒绝连接，必须提供显式许可和空的qisi_spec_*测试库。环境缺失返回not_run/非零；该检查本身也不证明应用恢复成功。应用npm命令由A01实现，不是当前规格包已经能执行的命令。

## POPO状态与旧基线

本轮只同步Git，**没有更新POPO**。publication/local-revision-status.json标记qisi-3.1为not_published；已有live-publication-status.json与回读/附件证据仍只证明qisi-3.0那次成功发布，不适用于本版。

原文档ID保持不变：设计a3ceafa9c4ac4a1ebab7ebd04068a9c2，规划98264ae3b38941a5aaf1b62e59abc31c，PRD0de4566fcbef4f9ebd7f9e474cf4b718。不要自动新建重复文档或执行发布脚本。

旧发布包可从Git提交e54ec4ac6710f94a32af449212b30227aeadb36d取回；旧ZIP SHA256为d4f62ea542b0c969e3ea6afade3377a9d20b2e41e7e5a32bbb98d71c75aca23b。本版包hash以当前manifest及publication/package-verification.json为准。

题库、模型key、MySQL/部署环境由项目方提供；缺外部条件标blocked_external，仍继续独立可做工作。不用fixture代替随机官方题库，不把模拟学生或原题完成当真实学习证据。

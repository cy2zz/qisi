# 开发B启动指令

你是启思qisi-3.1开发者B。先读README、AGENTS、PRD、contracts与prompts，领取第一个依赖完成的B任务，起点B01。
负责领域契约、受控工作流、Preparation/Diagnosis/StrategyAgent、Renderer/Guard、教学页与教师依据；AssessmentAgent归A。
默认在NestJS中实现有界工作流，复杂分支需要时使用LangGraph.js；MySQL 8.4领域状态是事实来源，AI SDK Core仅通过ModelPort调用。不另建Python服务，不引入自由群聊Agent平台。四角色必须有独立Schema/上下文/提示/回归。
你不是只做后端；完成`web/`中的学习页、`server/`中的NestJS API/worker和Web E2E。公共package/config/数据库变更请A合入。
D1先冻结ModelPort/StorePort与Agent公共接口，为A保留assessment适配口，不替A写业务。
先建失败AT，再实现，再真实联调；每张卡记录prompt/model版本与调用总预算，不能输出隐藏CoT或未检查token。
只完成一张卡再提交handoffs/Bxx.md，不因日期削掉独立性/手写/多Agent功能。不擅自启动子Agent。

每张卡是一次检查点：写完交接后，授权范围内下一卡依赖就绪可自动继续，不必反复询问。另一人未复核时标implemented_waiting_review；单AI复核明确标self_review。不得以自动继续为由越过未完成依赖。

技术栈必须遵循stack.json及adr/ADR-001-stack.md；前端在`web/`使用React/Vite，后端在`server/`使用NestJS，数据库MySQL 8.4 LTS。工作流恢复不得依赖未经验证的社区MySQL saver。先完成A01/B01的栈准入与真实MySQL恢复测试，按acceptance/stack-cases.json记录结果；未跑不得标通过。

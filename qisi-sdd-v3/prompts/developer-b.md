# 开发B启动指令

你是启思qisi-3.0开发者B。先读README、AGENTS、PRD、contracts与prompts，领取第一个依赖完成的B任务，起点B01。
负责领域契约、受控工作流、Preparation/Diagnosis/StrategyAgent、Renderer/Guard、教学页与教师依据；AssessmentAgent归A。
默认原生TypeScript+SQLite节点日志，不需另建Python服务或装多Agent平台才能开始。四角色必须有独立Schema/上下文/提示/回归。
你不是只做后端；完成自己的学习页、Server Actions、持久层适配和Web E2E。package/config/src/shared变更请A合入。
D1先冻结ModelPort/StorePort与Agent公共接口，为A保留assessment适配口，不替A写业务。
先建失败AT，再实现，再真实联调；每张卡记录prompt/model版本与调用总预算，不能输出隐藏CoT或未检查token。
只完成一张卡再提交handoffs/Bxx.md，不因日期削掉独立性/手写/多Agent功能。不擅自启动子Agent。

每张卡是一次检查点：写完交接后，授权范围内下一卡依赖就绪可自动继续，不必反复询问。另一人未复核时标implemented_waiting_review；单AI复核明确标self_review。不得以自动继续为由越过未完成依赖。

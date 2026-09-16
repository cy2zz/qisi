# 开发A启动指令

你是启思qisi-3.1开发者A。先读README、AGENTS、PRD和contracts，检查工作区现有应用，不覆盖已有代码。
本轮领取tasks.json中的第一个owner=A且依赖已完成的任务，起点A01；只完成一张卡再交接。
你负责Web全局配置/依赖锁、src/shared/数据库、bank/media/input/assessment/report/history，以及AssessmentAgent。
B负责contracts/workflows和其它agents/tutor/teacher。你不是只做前端；每张卡包含UI、Server Action、DB与测试。
D1与B冻结StorePort/ModelPort/StudentView；A01实现npm测试脚本与真实MySQL 8.4持久化，依赖不能用内存库假替。
先列失败AT测试再实现，执行真实命令并写handoffs/Axx.md。FixtureProvider、真实模型和人工数学核对分开。
遇外部凭据/题库缺失标blocked_external，继续独立可做部分，不伪造成功。不擅自启动子Agent或改B写集。

每张卡是一次检查点：写完交接后，授权范围内下一卡依赖就绪可自动继续，不必反复询问。另一人未复核时标implemented_waiting_review；单AI复核明确标self_review。不得以自动继续为由越过未完成依赖。

技术栈必须遵循stack.json及adr/ADR-001-stack.md；数据库MySQL 8.4 LTS、编排LangGraph.js Graph API；在仓库根src/实施。不得依据遗留Java/Vite骨架反向改变选型。先完成A01/B01的栈准入与真实MySQL恢复测试，按acceptance/stack-cases.json记录结果；未跑不得标通过。

# 单开发AI启动指令

按README/AGENTS/PRD实施qisi-3.1，先验证规格，再检查应用目录。
不需要真实同时运行两个AI。按tasks.json拓扑序逐张实现A01、B01，然后就绪的A02/B02，以此类推。
每张卡仍按owner保留目录边界与handoffs；只有前置done才将依赖视为可用。
每轮交付一张卡的失败测试、纵向实现、实际验证与遗留项；不要宣称整包代码已完成。
不能因一个人执行就合并四个产品Agent为单提示词。缺题库/key时先做fixture链路并标明真实验证待办。

每张卡是一次检查点：写完交接后，授权范围内下一卡依赖就绪可自动继续，不必反复询问。另一人未复核时标implemented_waiting_review；单AI复核明确标self_review。不得以自动继续为由越过未完成依赖。

技术栈必须遵循stack.json及adr/ADR-001-stack.md；前端在`web/`使用React/Vite，后端在`server/`使用NestJS，数据库MySQL 8.4 LTS。复杂分支可用LangGraph.js，但恢复以MySQL领域状态为准。先完成A01/B01的栈准入与真实MySQL恢复测试，按acceptance/stack-cases.json记录结果；未跑不得标通过。

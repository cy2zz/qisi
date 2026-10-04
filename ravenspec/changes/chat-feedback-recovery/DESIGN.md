# 技术设计与授权范围

单 AI / B07。沿用 B07 已有 chat 接线范围；A01 planned，B01/B03/B04/B05/B07 in_progress，不把整卡改为 done。

## 写集

server/src/features/analysis/{problem-analysis.service.ts,chat-feedback-policy.ts,turn-time-budget.ts,关联*.spec.ts}；server/src/workflows/policy-gate.ts；server/test/workflows/policy-gate.spec.ts；本 Raven 变更、B07 change/handoff、artifacts/acceptance/B07-20260930-chat-feedback-recovery/。
不改 A03/web/env/package 既有工作，不改数据库/DDL/依赖/公共响应契约。

## 流程

1. Strategy 先进行可信 source、fact/allowed 集合、帮助深度、稳定 goal 与探针预检。共享一次修复额度，仅注入代码常量纠错，之后重做全部检查。
2. Guard 私有 reference 增加 confirmed_evidence、诊断 judgment/evidence 和 decision acceptance_rule。学生内容明确标记为数据；Renderer 仍只有公开历史/题干/批准事实。
3. Guard revise 或实际披露越界，剩余 calls/output 足够时进行一次 Renderer 重写 + Guard 复核。只传安全代码指令，不传 Guard 原始 notes，不拓宽 allowed/reserved 集合。unknown 直接中性退出。
4. Strategy、Renderer、Guard 共用一次 Schema/策略修复，不能每角色重试一次。每次修复独立 node_key；重写也有独立 node_key。当前 chat 提示组合用 chat-recovery-v1 后缀审计。
5. TurnTimeBudget 接入现有 BudgetLedger，调用前保守预留，完成后按用量结算，失败保留预留；Schema失败保留实际 usage、output=null。未知 usage 使用估计输入与 maxOutput。原有90s/25s、取消和提交前 CAS/lease 边界不变。
6. 系统兜底按探针耗尽/帮助深度/通用核对失败区别说明，不再生成补充依据的新探针；不附曝光 audit，finish 保持 unknown。仅日志记录 requestId/sessionId/reason，不含原始学生文本/私有笔记。

预算是当前 chat 请求内有界执行；节点尝试通过既有 recordTurnNode 持久化。本轮不新增崩溃重启续跑机制，也不声称完成全工作流恢复。

## 验证与回滚

失败先行：新增14项测试原实现全部失败（34项既有测试通过），修正新文件管道编码后重跑，保存 red-tests-utf8.log。测试覆盖修复/重写次数、null-probe、unknown、Schema失败审计、调用/token、取消迟到值、私有数据隔离。
真实 Nest/Supertest + fixture ModelPort/Store，验证只对最终安全文本 commit/chunk/done，不将 fixture 误标真模型/MySQL。
服务端定向/全量测试、typecheck/lint/build；B07 task/e2e/stack 脚本如缺映射按实际 exit1/0测试记录。
回滚仅反向应用本轮明确 diff；不 git restore 覆盖他人工作。无DDL/依赖迁移。
Raven CLI 仅本地创建/状态核验，不宣称远端 Spec Tracker、KnowVault、独立评审、发布或归档。

## 2026-09-30 等价表示与明确修复协议补充

本续轮额外写集：analysis service/反馈规则/unit、显式opt-in equivalent-route.live.spec.ts，以及B07/Raven记录、本轮equivalent-route证据。无依赖、DDL、前端或Assessment改动。

1. Diagnosis/Guard共同遵守学生索引/互补选择/系数语境规则；错误因子、符号、幂次仍严查。
2. 完整作答的confirmation_template由代码从当前evidence_refs原文构造，仅放数据，随后仍过Strategy/Guard全部校验。
3. Strategy失败分静态validationCode，最多一次repair获得具体可信纠错；日志不带未校验候选/私有notes。
4. Strategy提示对齐非确认事实必须在披露集合内的现有约束；Guard收到完整approved_facts/acknowledgement_facts，actual_disclosed_ids按实际新增帮助计，不通过代码扣除。
5. 提示后缀equivalent-route-v2；不改7calls/90s/25s、共享修复/重写预算、unknown、两探针、最终提交与帮助记账。

本轮确定性回归130/130，全量server712通过/21跳过，typecheck/lint/build通过；当前v2正式真模型批次1通过/1失败，额外诊断采样不合并统计。B07完整门禁/人工教学评估/独立复核未完成，维持implemented_waiting_review。详见B07 change/handoff及本轮commands.json、summary.json。


## 2026-09-30 答案优先与可信证据目录

- B侧新增agents/diagnosis/cited-diagnosis适配与单测，analysis新增有限live样本与HTTP/SSE引用恢复用例；公共契约、依赖、数据库和前端不改。
- chat提交内部task_id与Diagnosis任务统一；输入先经Schema和最新有效证据筛选。evidence_catalog由服务器生成，e0为chat当前有效提交；wire接受strict evidence_key或原EvidenceRef，解析后服务器绑定精确原文/revision，再恢复canonical Diagnosis交由全部语义检查和Guard。未知编号、混合字段、伪造原文不自动纠正，不做模糊文本匹配。
- Diagnosis先独立核对最终答案、再核对过程/等价路线；仅数字相同不授予正确完整。已有确认模板与当前证据/原整题路线要求保留。
- 诊断Schema、引用、task/decision/goal错误进入静态码修复；只使用既有全回合一次schema修复额度，canRecover(4,5100)确保普通后续路径空间。二次校验失败安全退出；provider异常/取消/超时仍按既有故障逻辑处理。
- diagnosis_repair独立节点审计，failed output=null，实际用量计账；只输出静态validationCode/nodeKey/inputHash日志。不向学生或repair提示泄露失败候选/私有笔记。prompt后缀answer-first-evidence-v1。
- 实测定向153/153，全量735通过/24跳过；typecheck/lint/build exit0。有限真模型三例2pass/1fail；漏因子反例修复诊断后策略仍不合规，共享额度已用完，保持安全退出，不为通过而增加次数。详见B07记录与answer-first-citations证据。

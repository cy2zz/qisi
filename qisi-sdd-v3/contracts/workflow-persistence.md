# NestJS 工作流 + MySQL 持久化契约｜qisi-3.1

本文件是必须实现的设计，不是现有实现。对应 ADR-001；B01/B07 负责工作流与恢复接线，A01/A07 负责迁移和数据库事务门面。

## 1. 工作流及人机边界

- prepare：Preparation → Guard → PolicyGate → commit；不可靠时保留原题待核对。
- turn：Diagnosis → 可选 route_review → Strategy → PolicyGate → Renderer → Guard → commit。
- grade：Assessment → Guard/代码规则 → commit；模型不决定 independent。
- transcribe：Vision ModelPort → schema/图像规则 → 草稿提交；学生确认后才能进入 turn。
- 等待学生发生在已经提交的领域状态边界；下一次输入创建新 run。不保持跨数小时 HTTP 或数据库事务。
- NestJS 领域服务掌管权限、预算、状态和最终事务。复杂分支可以用 LangGraph.js StateGraph，但图不是业务事实来源。
- 私有工作流状态不得进入 React props、浏览器、SSE 原始载荷或公共日志。

## 2. MySQL 事实模型

服务端生成 `run_id`。requests、runs、node_runs/workflow_steps、model_calls、jobs、events 与领域表共同构成事实：

- requests：owner + request_id 唯一；保存 payload hash、安全响应和幂等结果。
- runs：workflow、owner/session、版本、deadline、lease、fencing token、配置哈希和状态。
- workflow_steps/node_runs：node key、input hash、模型/提示版本、尝试、校验后私有结果和状态。
- model_calls：所有调用、修复、重写和失败尝试的 usage、耗时、provider request id。
- jobs：API 与 worker 之间的持久任务；通过 lease/fencing 领取，超时后有界恢复。
- events：已发生的输入、公开消息、帮助曝光、修订、取消与删除事实。

如果保留 `workflow_checkpoints` / `workflow_writes`，它们只是可选的图执行快照。业务恢复必须能先根据 run/step/request 判断已提交、取消、删除、过期或待继续状态。

## 3. 事务与恢复

1. API 在 MySQL 短事务中验证 owner、Origin、schema、expected version 与 request id，创建 request/run/job 后立即返回安全状态。
2. worker 通过 `SELECT ... FOR UPDATE SKIP LOCKED` 或等价原子条件更新领取任务，生成新的 lease 和递增 fencing token。
3. 调模型前写 started 与预算预留；远端调用期间不持有数据库事务。SDK 自动重试为 0，再次尝试统一计预算。
4. 结果按 input hash + model + prompt + config 持久化并严格校验。只有有效 owner/run/lease/fencing/deadline 才能保存。
5. 唯一公开提交点是 `StorePort.commitChecked` 或等价 NestJS 领域服务：短事务写安全消息、events、实际帮助曝光、状态/version、request succeeded 和 run completed。
6. commit 成功但 worker 响应丢失时，重复请求直接回放 requests 中的同一安全响应；不得再次调模型或重复曝光。
7. 取消、删除和过期先撤销 lease。旧 worker、晚到模型结果和旧 checkpoint 均不得复活会话。
8. 首版一个恢复 worker；扩展多 worker 前必须验证租约抢占、fencing、死锁和重复领取。

不承诺远端模型 exactly-once。只有 started 没有结果时，重试可能重复计费，必须计预算并留下证据。

## 4. 可选 LangGraph checkpoint adapter

不得因为包名含 mysql/langgraph 就默认采用社区实现。采用或自研 `BaseCheckpointSaver` 前必须核验许可、维护状态、目标版本，并覆盖：

- getTuple/list/put/putWrites/deleteThread 与 typed serializer。
- before/limit/filter、parent config、pending writes、task path 和特殊 write index。
- 相同键幂等、内容冲突、损坏序列化和版本不兼容。
- 重启、取消、删除、过期、租约轮换和晚到写入。
- checkpoint 前后、领域 commit 前后杀进程。

所有写入仍须经过 ActiveRunContext 和有效 fencing；checkpoint 成功不代表领域 commit 成功。adapter 不得自行建立第二连接池、运行时偷偷建表或形成第二套状态机。

## 5. StorePort 协作

A 在 `server/src/shared/db` 提供 mysql2/Kysely 门面与 ActiveRunContext：pool、短事务回调、任务领取、`lockActiveRun`、服务器 UTC 时间和参数化查询。B 不得绕过门面或在模型调用期间占用事务。

固定锁顺序：存在 session 时 session → run → request → 明细表；无 session 时 owner → run。删除 owner/会话先撤销相关 run，再级联清理。事务重试不包含模型调用。

schema、workflow 和可选 checkpoint 序列化版本写入配置。24 小时媒体/草稿与 7 天会话清理同时清理对应私有节点输出和可选快照，不允许 checkpoint 绕过 TTL。

## 6. 最低验收

A01/B01：真实 MySQL 中完成 API 创建任务、worker 领取、节点落盘、最终提交、React 刷新读取和 Node 进程重启续跑；同 request 响应一致，不同 owner 隔离。

A07/B07：在任务领取前后、模型调用前后、节点结果后和 commit 前后断数据库或杀进程；覆盖取消/删除/过期与晚到写入、lease 抢占、fencing、首次计划、final 与帮助曝光不变量。

只有实际采用 checkpoint adapter 时才执行完整 saver conformance；否则 ST06 以领域 run/step/jobs 的等价恢复协议验收并明确记录实现路径。缺 MySQL 8.4 环境记 `blocked_external`，不能用 SQLite 或内存 saver 替代。

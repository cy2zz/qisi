# LangGraph.js + MySQL 持久化契约｜qisi-3.1

本文件是必须实现的设计，不是现有实现。对应ADR-001；B01/B07负责适配，A01/A07负责迁移与事务。最终按所锁定@langchain/langgraph-checkpoint版本核对方法签名，不能凭示例猜库API。

## 1. 图及人机边界

- prepare：Preparation → Guard → PolicyGate → commit；不可靠时保留原题待核对。
- turn：Diagnosis → [必要时Preparation.route_review + Guard] → Strategy → PolicyGate → Renderer → Guard → [最多一组改写+Guard] → commit。
- grade：Assessment → Guard/代码规则 → commit；上下文不注入旧诊断画像，不由模型判independent。
- transcribe：Vision ModelPort → schema/图像规则 → 草稿提交；必须等学生显式确认才能进入turn。
- 等待学生发生在已提交的领域状态边界，结束本run；下一次学生输入创建新run并读取已确认SessionState。不保持跨数小时的HTTP/数据库事务。不用长寿命线程累积全部学生私有答案。
- LangGraph负责路由；预算、lease、数学/权限/曝光规则在项目代码。GraphState必须私有且最小化，不进入RSC、浏览器或公共日志。

## 2. Checkpoint的键和API

服务端生成run_id，并作为thread_id。顶层图checkpoint_ns固定空字符串，暂不引入动态子图命名空间；checkpoint_id由库管理，客户端不可指定任意thread/checkpoint恢复。run记录包含owner、session（可为空的转写run）、request、版本、截止时间、lease和配置哈希。

MySqlCheckpointSaver基于所锁版本的BaseCheckpointSaver，必须覆盖getTuple、list、put、putWrites、deleteThread，以及库要求的版本生成/序列化协定。方法签名在A01/B01锁版本后与官方类型对齐；依赖typecheck与conformance测试，而不是自造结构冒充协议。

- getTuple：指定checkpoint或取该run/ns最新值，恢复config、parentConfig、metadata、checkpoint、pendingWrites。
- list：支持该库要求的before、limit、metadata filter；结果确定性排序。未支持项必须显式报错，不静默忽略。
- put：完整checkpoint使用库的typed serializer保存type + bytes；metadata存JSON。保存所有channel values（不自行抽取/丢失），返回可继续执行的config。相同键与内容可幂等；同键内容不一致报错，不能任意覆盖历史。
- putWrites：按库定义的task_id/write index及特殊写索引保存pending writes，保留序列化类型与task_path；负索引/覆盖规则按所锁库协议实现并测试。普通写重复不累加预算。不能一律INSERT IGNORE掩盖冲突。
- deleteThread：删除run的checkpoint与pending writes，但不是业务删除入口；业务删除必须先撤销run lease再级联清理。
- 不使用pickle/任意代码反序列化。恢复数据只接受服务端曾写入、版本兼容的格式；损坏/不兼容数据返回可恢复错误，不向用户输出私有原文。

contracts/database.sql中的workflow_checkpoints/workflow_writes为初始逻辑表。若库升级确需调整布局，B提交有前向迁移与回归的变更，A合入；不能在运行时让saver未经版本记录自动建表。

## 3. 事务与恢复：不承诺远端模型exactly-once

1. StorePort.reserve在MySQL短事务中取得session行锁，核验owner/版本/无活动run，唯一request键处理幂等；写run/lease和reserved_version后提交。所有服务调用先检查requests是否已成功。
2. 图执行前后都验证run有效。模型调用之前写node_runs.started与预算预留；远端调用期间不占数据库连接/事务。AI SDK maxRetries=0，图节点无隐式自动重试；所有再次尝试由统一预算器计数。预算已消耗/预留以MySQL node_runs/run记录为准，恢复旧checkpoint不能回滚调用次数或token消耗。
3. 节点结果按input_hash + model + prompt + config持久化，并写图checkpoint。checkpoint与node_runs不要求跨表外加长事务；恢复时仅复用有效lease下同哈希的已完成节点。只有started但无结果时远端可能已收费，重试必须计预算并报告重复计费可能。
4. **唯一公开提交点是StorePort.commitChecked。**短事务重新锁run/session，确认owner/期限/lease/reserved_version，写events、实际帮助曝光、状态投影/version、请求安全响应、run完成状态。暴露清单在现有事件/状态契约中持久化，不新增不一致的第二套账本。
5. graph checkpoint成功≠领域提交成功。commit失败不得显示老师内容。领域commit成功而最终checkpoint落盘失败时，重试先读requests.succeeded并返回同一安全响应，不能再调用模型、重复曝光或抛弃已经提交的消息。提交节点必须先查幂等记录，重复执行不可重复产生副作用。
6. graph恢复前先查业务run/request；已成功只回放安全响应，已取消/删除/过期禁止恢复。恢复未完成run时使用新的executor fencing token，原lease失效；同run最新有效token才能保存结果/commit。更新token通过条件更新/行锁，仍保留request/run身份。新token只通过服务端执行上下文注入，绝不从旧checkpoint恢复lease或认证身份。
7. saver的put/putWrites也必须经过StorePort提供的有界事务门面：锁run并核验有效lease/截止与归属，禁止仅凭thread_id写入。删除/取消先撤销lease，再删除私有快照；迟到写入拿不到有效run不能插入。底层FK是第二道保护，不能替代授权。
8. 首版只有一个应用恢复器；数据库保证原子操作但不自动保证分布式安全。二实例上线必须另做ADR及抢占/租约测试。

## 4. 与MySQL/StorePort接口协作

A提供src/shared/db事务门面与ActiveRunContext类型：pool、短事务回调、lockActiveRun(runId, leaseToken)、服务器生成的UTC时间和参数化查询。接口由A/B D1共同冻结，B不得自行新建无界连接池或绕过门面。

run生命周期以及checkpoint写入使用同一数据库。固定锁顺序：存在session时session→run→request→明细表；无session的run先owner→run；所有路径遵循同一规则。删除owner/会话必须撤销相关run再级联，测试死锁并对可重试事务做有界重试；事务重试不包含模型调用。

schema版本与checkpoint序列化版本记入迁移与run配置；不兼容的旧run保持failed/需重试，保留已提交输入和帮助，不伪装成功续跑。24h媒体/草稿清理与7d会话清理同时清理对应checkpoint、pending writes、node私有输出；不允许checkpoint成为绕过TTL的第二份永久档案。

## 5. 最低验收矩阵

A01/B01：真实MySQL put/getTuple/list/parent/pendingWrites往返；停止Node后恢复图；同一request安全响应一致；不同owner隔离。A01提供容器/迁移、B01提供测试图及saver。
A07/B07：在节点调用前、节点结果后、checkpoint前后、commit前后断开数据库/杀进程；删除/取消/过期与晚到checkpoint竞态；首次计划/final/帮助记录不丢失；不同run隔离；特殊write index与namespace匹配。逐项对应ST06–ST12和AT42–AT46。
缺MySQL8.4环境则记录blocked_external，不能用SQLite/InMemorySaver跑过替代。当前本文件所有运行验收not_run。

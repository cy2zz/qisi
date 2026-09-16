# 服务端契约、状态和实现规则｜qisi-3.1

48个严格JSON Schema见domain.schema.json，16个NestJS应用操作边界见server-functions.json（文件名仅为规格包兼容保留，不表示框架级 Server Function），角色见agents.json，状态见state-transitions.json。Schema只控制结构，本文件中的引用、数学、授权、曝光与幂等规则必须另写代码测试。所有日期UTC ISO8601；UI按本地时区显示。

## 1. 目录与归属

应用目录固定为 `web/` React 前端和 `server/` NestJS 后端/worker；规范包固定在 `qisi-sdd-v3/`。现有目录属于未提交迁移，步骤见 adr/ADR-001-stack.md。A维护公共配置、`web/` 公共UI、`server/` 数据库门面和迁移、bank/media/input/assessment/report/history；B维护server中的contracts/model/agents（assessment子目录由A负责）/workflows及web中的tutor/teacher。B01建立Agent公共接口时为A保留assessment空导出，不抢写其业务实现。A01和B01只冻结公共契约，不能为“架构准备”拖延一整天。

A/B的具体日任务以tasks.json为准。同一天禁止父glob跨写他人的已分配子目录：例如B09 `server/src/agents/**`明确排除`server/src/agents/assessment/**`，A08修改B拥有的E2E用例前先交接。共享文件单人写、另一人提patch建议；不互相覆盖。

## 2. 信任边界

- SessionState/Packet/Diagnosis/Strategy/TraceStep/CheckTask是服务端私有对象，绝不作为React组件props、静态资源、SSE原始载荷或API通用返回。
- StudentView、Report是白名单投影，从零构造；禁止使用展开运算符复制私有对象后删除几个字段。学生看不到未来检查题题干与rubric。PublicGoal只可来自已经批准显示的当前目标，不自动把完整教师路线投影出去。
- 服务器通过HttpOnly高熵owner cookie确定归属，不接受body里的owner_id。生产Secure、SameSite=Lax；teacher独立短期cookie、登录限流，必须获当前会话授权。
- 所有有副作用函数检查Origin、身份、归属、schema、request_id和expected_version。未知资源/他人资源统一NOT_FOUND。GET不得写状态或产生曝光。
- teacher登录后并不能任意枚举用户内容。比赛单会话可由owner生成一次性会话授权码（10分钟，单次，服务端哈希保存）供教师绑定；同浏览器owner+teacher允许访问自己的会话。授权码不能含答案，不能写进公开日志。生产多用户扩展另行设计。
- openTeacherTrace需explicit confirm并先持久化当前task whole_task曝光。教师只取已发生的教学决策/对应run安全摘要，不取未来题答案、模型系统提示、凭据或隐藏CoT。正文允许简短可审计理由，不声称复现模型内部思维。

## 3. 全题库与数学包

Problem.content_hash=SHA256规范JSON({statement_md,source,is_official,asset_content_hashes})；canonical JSON键排序、UTF8、LF、保留数学字符，不进行可能改题意的空白/符号等价化。assets按声明顺序保存真实字节哈希。ID和题库版本也要存，但不用于把内容变更伪装成旧包。

导入源使用UTF8 JSONL，每行ProblemInput包含id/source/is_official/statement_md/topic_tags及asset_filenames（只允许本次已上传文件的安全basename）。status/content_hash/asset_ids由服务端计算，浏览器不能指定ready。上传JSONL上限20MB、单批题图压缩包上限100MB；解压总量200MB、单图20MP、条目最多5000、拒绝绝对路径/..、符号链接和zip bomb。实际题库大于上限分批导入同一bank_version，完成后freeze manifest；不因分批漏题。A02须根据主办方实际格式写归一化适配器，无法读的记录进入异常清单，不 silently drop。

随机默认服务端从冻结bank manifest所有ID均匀抽取（crypto.randomInt），含needs_review/invalid。记录范围排序ID集合哈希、bank_version、request_id、选中ID；禁止客户端自行提交候选池。若需比赛指定子集，独立教师配置scope manifest，UI明示范围并确认，不以准备状态自动收缩。随机机制测试验证范围与重试，不以少数采样频数宣称统计均匀。

selectAndStart先创建session phase=preparing并持久选题，再调用prepare。未ready返回当前StudentView和notice，不另抽题。人工修复题干产生新hash，旧包失效；已开始会话固定题目快照，题目被证实错误则显示需复核，不把会话悄悄换版本。

Packet.ready必须hash匹配、reference_source非空、有verification记录、无blocking_issues。model_checked只是模型复核；human_reviewed必须有真实执行者/日期/依据，不能由模型自填成真。Guard不能验证普遍数学真理，冲突和证据不足保留unknown。全量结构核验与抽样人工数学核对分开报告。

主图2–12个关键决策为目标，Schema允许1–24（简单题1个、大型综合题最多24）；超过24先按小问分组整理，不截断剩余题目。每个Route.decision_ids引用存在节点、terminal_ids是其中元素；同一路线按prerequisite_ids为AND无环；routes是OR选择。一个新路线补丁不得改写旧有效证据；未核对路线只记录待定，不可用它推进错误结论。

## 4. 数据持久化

实施时按database.sql创建基础表，复杂私有内容可JSON列保存，但关键唯一性和并发字段必须真实SQL约束，不能全靠内存数组。

| 表 | 关键设计 |
| --- | --- |
| owners | cookie hash、expiry、history_incomplete；不保存姓名/学校 |
| bank_manifests/problems/packets | 版本、快照、内容hash、状态与核对证据；题库数据不随学生删除 |
| sessions | owner、version、phase、state_json、active_run_id、expires_at |
| requests | UNIQUE(owner_id,request_id)，payload_hash含action/session；安全响应持久化 |
| runs/node_runs | lease_token、deadline、input_hash、role/model/prompt、状态和私有输出；模型调用期间不持有数据库写锁 |
| events | session单调seq，类型/subject/dependency_ids/payload；追溯而非记录隐藏思维链 |
| media/transcripts/submission_revisions | 私有路径和哈希、确认行、旧新revision、TTL |
| probe_counters | UNIQUE(session_id,task_id,canonical_goal_key)，换节点名不重置 |
| check_attempts | UNIQUE(owner_id,task_hash)，开始即占用；计划锁定/首次final/帮助请求/曝光 |
| seen_tasks | owner、task_hash、equivalence_group、首次展示时间；跨保留会话避免重复任务 |
| teacher_grants | owner/session的短期授权和单次授权码；不公开枚举 |

events、exposures和check_attempts以数据库为准，SessionState JSON是可核对投影。对外原子事务同时写events、state/version、checked消息、exposure与request安全响应；必须有投影一致性测试。大对象不要无限增长，单会话最多200教学轮，到上限保留历史并提示新会话，不静默截去曝光/先前证据。

## 5. 幂等、CAS与恢复顺序

1. 解析并验证owner/Origin/body；计算payload_hash，查询request唯一键。相同ID同payload已成功直接返回旧安全响应；不同payload REQUEST_CONFLICT。
2. 短事务校验session.version，检查无其他active_run；建立request/run/lease，保存用户输入或冻结final，提交事务。此时公开响应只显示已提交输入与阶段，无未检查老师内容。
3. 调模型前计算node input_hash（包括model/prompt/config），写started事件；调用结束独立短事务保存私有结果。节点复用只在全部哈希一致且lease有效时允许。
4. PolicyGate/Guard通过后重新检查owner/session存在、版本与lease、deadline。单事务写最终消息、事件、实际曝光、state、version+1、request succeeded；再返回安全投影。
5. deadline过期或删除撤销lease后，迟到调用结果不能提交，也不能重建session。断网但已commit用原request恢复，曝光保守保留。未检查或未提交的文本不能当已经显示。
6. worker重启枚举未过期run/jobs；input_hash匹配的已完成节点复用；远程结果未知的节点可以重试但计费可能重复。首版只有一个恢复worker；MySQL行锁/CAS/lease/fencing防重复提交，不据此宣称多worker已验收。恢复按contracts/workflow-persistence.md执行，可选checkpoint不能复活被删会话。
7. reserve与final都可能提升version：内部run带reserved_version和start_version，公开轮询展示最新version；同一run最终提交用reserved_version。客户端不得继续用旧version提交并发轮。最简单实现每次状态变更都version+1，客户端只用服务端返回版本。
8. failed request保存错误与已发生副作用状态；相同request重试只复现结果不重跑，UI“重试”产生新request_id但绑定原任务和冻结输入；final评分重试复用同attempt的首次plan/answer，不开放编辑后冒充首测。

## 6. 预算与队列

runtime.json为规范默认值，服务器可降低上限，但不能在未记录变更时放大；统计总调用包含schema修复、route_review、Guard、重写及失败尝试。网络重试也算调用；provider SDK的自动重试默认关闭以免账外重试。shared max_concurrent_model_calls=4，队列等待计入deadline；超过等待预算给BUSY/timeout，不能悄悄丢输入。

普通节点25秒、prepare节点60秒，受workflow剩余deadline进一步截短。取消用AbortSignal并撤销lease；远端是否真正取消不可保证，记录可能消耗。模型不支持精确usage时，用保守输入token估计+max_output预留，记录estimated；未知usage不能绕过预算。

普通turn四调用，最多7；一次route_review额外需要PreparationAgent+Guard=2，仅余预算够才执行。schema修复每run共1次、文字重写+Guard最多一组，共用剩余预算，不保证每条故障分支都有重试额度。route审查失败保持待定，不能为赶预算跳过Guard。阶段轮询不显示原始模型token。

## 7. 诊断、策略、曝光跨字段校验

EvidenceRef必须引用当前有效confirmed Submission的准确revision，quote必须能在原文本找到（允许明确的换行归一化，不允许编造）。手写若含未解决歧义则先确认，不把“不知道输入是什么”诊断为数学不懂。

Diagnosis.judgment描述当前数学有效性，hypotheses描述原因，两者不得合并为一个标签。ProbeProposal.branches至少两支，hypothesis_id有效且不同；expected和counter_evidence有实质区分。输出显示前将批准的question/branches存事件，ordinal由代码按canonical goal分配。分支预存是决策承诺，不等于已经确认诊断。

canonical_goal_key从task_id+稳定目标登记表产生，补偿节点parent_goal_key映射到相同未决目标。模型不可自己新建key逃避计数。最多两次真实显示的诊断探针；失败/没显示的不虚增，但已经显示之后修改输入也不归零。

Strategy.allowed_disclosures/reserved_decisions均属于当前task且不相交；allowed_facts来源可追，不能在文本中夹带保留答案。PolicyGate检查用户明确worked_solution时允许提升披露，但仍核对数学、记whole_task曝光，不伪装成L0。跳阶必须引用有效产物而不是自评按钮。

RendererInput是最小信息；从Strategy投影question_md和approved facts，不给私有reference。GuardResult.accept才可显示。actual_disclosed_ids须属于当前task；明显有帮助但无法定位则whole_task。Guard声称none但文字明显含答案是需回归的人为质量问题，不能只靠schema防止。

## 8. 独立检验状态细则

start/reassess从study/summary调用；已进行的未结束attempt不能再start。候选verified、未向owner展示、task_hash未见、equivalence_group未被使用，且relation=near_transfer才用于新的迁移检验。near_duplicate可用作带标识练习，但不作为默认重测候选，报告不能记迁移独立通过。

start先原子写seen_tasks/check_attempts，再返回题干；刷新不重置。check_plan只允许编辑计划，提交plan或显式“没有计划”后锁定；check_answer只允许编辑答案，不能改plan。draft保存不调模型也不显示正确性。finish先冻结最终答案并终结该次提交，再调用AssessmentAgent+Guard；失败unknown，重评分只复用冻结内容。

check help从plan/answer阶段提交assistance_requested=true并快照当前产物，切study且active_task仍是检验题，然后进入普通turn帮助。若模型失败，help_exposed仍false；若帮助已checked commit，则置true并写Exposure。仍可提交带帮助的最终答案，但不恢复独立资格。

AssessmentAgent上下文不含历史误诊、学习画像或teacher标签，减少先入偏见；独立性不由它评。原题finish也必须数学核对；“结束学习”可以结束会话但不能宣称原题correct。

Report公式：eligible = first_seen_eligible AND relation=near_transfer AND NOT assistance_requested AND NOT help_exposed AND NOT invalidated AND finished_at存在。independent_planning=eligible AND planning=correct；execution同理；task_pass两者都true。unknown/未答/未测/有帮助/作废均false。所有实际帮助取ledger OR attempt标记，数据冲突时按保守有帮助处理并报警，不取较小值。

近迁移结果只说明该次该任务的表现。系统只知道当前匿名owner与保存期限内的展示记录，无法知道外部搜题、另一个浏览器或清cookie前经历；界面说“本系统未记录先前曝光”，不宣称绝对未见。主动删除相关历史后将owner.history_incomplete=true，后续检验first_seen_eligible=false直至用户明确开启新的非可比观察记录；不能用删除帮助洗白。若删除全部owner并清cookie，则无法追踪，报告必须保留此局限，不能声称防作弊。

## 9. 修订与隐私

correctSubmission保存旧/新revision；依赖旧revision的diagnosis/strategy/decision evidence失效，之后受影响的check结果invalidated。保守可以将该会话修订点之后全部推断/检验失效，但绝不删除已显示的帮助、首次展示或探针计数。重新诊断使用新revision；学生看得到哪些结论待复核，不用“你以前错了”掩盖OCR错误。

图片与临时草稿24小时到期删除；确认文本随会话7天；会话/owner主动删除级联撤销run、移除私有媒体、转写、revision、trace和request。仅保留当前owner的history_incomplete布尔说明历史不完整，不保留已删除题干/手写/内容；完整删除owner时连该布尔也删。公共题库和其准备包不是学生数据，不随会话删除。自拟fixture不能含真实个人数据。服务日志只记录脱敏ID、状态、时延、token，不永久记录请求正文。

## 10. 开发验收命令约定

A01创建npm scripts：dev、build、start、typecheck、lint、test、test:e2e、test:task、test:e2e:task、eval:roles、eval:teaching、bank:audit、release:check。test:task A04根据qisi-sdd-v3/tasks.json取AT集合，选择对应unit/integration测试；test:e2e:task同理。测试title带ATxx标识、用例注册到tests/coverage-manifest.json。没有可执行测试不能以“0 tests passed”视为成功；对应层为空时需输出not_applicable和人工项待办。人工/model_review不能由自动脚本填passed。

默认FixtureProvider只用于确定性测试；eval:*必须要求REAL_MODEL=1并检查真实usage/response元信息，缺凭据失败并给配置项，不自动转Mock冒充。所有人工/模型用例保持not_run，直到证据JSON包含执行人、commit、题库/model/prompt版本和实际结果。

## 11. 手写模型输出投影与开发续跑

视觉模型只输出vision-output.schema.json定义的VisionOutput：lines[{index,text,uncertain}]。它不输出TranscriptDraft的id/media_id/revision/confirmed，也不输出explicitly_confirmed。A03在服务端严格解析、验证行号递增且唯一、合计文本不超过12000字符，再分配标识/revision=1/confirmed=false，各行explicitly_confirmed=false，构造TranscriptDraft并验证领域Schema。模型返回服务端字段时拒绝，不直接信任；用户确认只通过ConfirmTranscriptInput和revision校验生效。独立检验计划/答案的转写也走相同流程，不能在转写里暗带评分。

任务可用planned/in_progress/implemented_waiting_review/done/blocked_external状态。机器tasks初始全部planned；本包静态验证器针对初始交付状态，不作为应用开发后禁止状态变化的检查。开发后由A01建立应用内的任务/覆盖校验，保持引用与验收规则不变。每卡完成写交接后，可自动领取授权owner的下一就绪卡，无需反复询问是否继续；只有真实外部阻塞、权限不足或改变P0/写集时停下说明。双人交付需另一人复核；单AI串行可先做独立复核阶段并记录self_review，不能冒充第二人签字，最终发布仍由项目方确认。

## 12. qisi-3.1技术栈执行门禁

唯一决定：adr/ADR-001-stack.md与stack.json。`web/` React/Vite + `server/` NestJS + MySQL 8.4 LTS/mysql2/Kysely；LangGraph.js仅按需用于有界图，AI SDK Core只做模型I/O。实际骨架尚未验收。SQL语法验证不使用SQLite内存库，真实DDL检查用scripts/validate_mysql.py。

A01额外建立db:migrate、db:seed:fixture、test:db、test:stack命令：
- db:migrate映射版本化MySQL迁移，先验证server/schema版本，失败停止；不能空脚本返回0。
- test:db运行tests/integration/db中的真实8.4测试；缺数据库失败并记录blocked_external，不自动换Mock。
- test:stack -- A01/B01/A07/B07/A10/B10按tasks.json的stack_acceptance选择ST用例。自动/模型/人工分类；没有实际证据的ST不得passed；真正不适用的层单独注明原因。
- tests/coverage-manifest.json同时映射AT与ST；前者60项、后者12项，各自分母分别报告。

A拥有`web/src/shared/**`、`web/src/components/ui/**`、`server/src/shared/db/**`、`server/migrations/**`和公共配置/依赖；B拥有`server/src/model/**`与`server/src/workflows/**`。B不复制共享DB连接池，A不建立第二套模型I/O。schema_migrations由A统一维护，任何可选saver也必须使用同一有界门面。所有新命令必须由实际测试驱动。

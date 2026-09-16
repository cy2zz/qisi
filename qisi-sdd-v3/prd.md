# 启思｜多Agent Web SDD PRD V3.1

> 交付基线：qisi-3.1；规格核验日期：2026-09-16。设计V6.1、开发规划V3.1与PRD V3.1配套使用，完整机器契约、测试夹具、A/B启动提示和校验脚本见仓库当前qisi-sdd-v3.zip；POPO仍是历史qisi-3.0附件，本次未同步。本交付是开发规格，不是已实现的应用或学习效果证明。

唯一实施基线qisi-3.1；2026-09-16。两位开发者A/B，约10开发日，全栈Web单体，不是前后端分开开发。设计V6.1、规划V3.1和本PRD同版本使用，替代qisi-3.0的技术栈决定，并保留其全部产品范围。

**交付状态：规格设计。未实现应用，未运行真实模型/学生实验。** 本PRD正文包含产品行为、实现步骤、A/B任务、接口与验收；随附qisi-sdd-v3.zip提供严格Schema、用例、提示约束、SQL与校验脚本。开发AI应先读取正文，再读取附件，不能在附件缺失时自行猜测关键契约。

## 已确认技术栈（ADR-001，qisi-3.1）

| 层 | 唯一实施选择 |
| --- | --- |
| Web / 语言 | Next.js 16 App Router + React 19 + TypeScript + Node.js 24 LTS |
| UI | Tailwind CSS + shadcn/ui |
| 多Agent编排 | LangGraph.js Graph API（正式基线，不再是候选） |
| 模型接入 | AI SDK Core，经项目ModelPort；provider按比赛资源与实际能力测试选择 |
| 数据库 | MySQL Community Server 8.4 LTS + mysql2；InnoDB/utf8mb4，无ORM |
| 验证/渲染 | Zod；react-markdown + remark-math + rehype-katex/KaTeX |
| 手写 | sharp校验解码 + 多模态转写 + 学生确认，不新增Python服务 |
| 测试/部署 | Vitest + Playwright + 真实MySQL集成；单Node应用 + MySQL + 私有媒体卷 |

决定与现状必须区分：以上选型已获确认；精确patch和镜像digest待A01真实安装后锁定；仓库现有Java/Vite骨架尚未迁移。实施位置是qisi-dashboard仓库根src/，不另建应用仓库。

核心调整：LangGraph复用节点/分支/恢复能力；AI SDK只做模型I/O；MySQL保存业务与checkpoint。最终状态/帮助曝光/幂等/取消仍由代码PolicyGate和StorePort事务控制，不由checkpoint替代。MySQL saver的薄适配由B01负责、全部迁移由A01负责；先通过ST01–ST07，D7补完整故障门禁ST08–ST12。A/B任务、迁移/图协议见stack.json、adr/ADR-001-stack.md、contracts/mysql.md、contracts/workflow-persistence.md、acceptance/stack-cases.json。

这是规格更新，不是依赖集成或应用验收。原18条P0、20张任务、60项AT全部保留；新增12项ST不替代教学质量与独立学习证据。

## 1. 产品目标和非目标

P0目标：任意题库题目可选；识别学生当前思维卡点；有证据地干预；尽可能让学生完成关键决策；支持Markdown/LaTeX与手写；可解释教学依据；用撤去帮助后的新任务表现作为学习证据。

不追求：解题榜单第一、回答越长越好、多Agent越多越好、题目拆得越碎越好。完成原题、答对引导问题、自我感觉理解，不等同真正独立完成新任务。

不在本次范围：原生客户端、独立后端项目、账号付费、学校班级管理、模型训练、全学科知识图谱、自由联网Agent、录音/语音课。题库与模型可换，不把演示自拟题写成特殊分支。

## 2. 给开发AI的第一条指令

```text
你正在实现启思qisi-3.1，只做一个全栈Web应用。
先读本PRD与附件README/AGENTS，确认应用目录和当前任务状态。
若附件可读取，运行 python scripts/validate_spec.py 核对规格完整性。
按任务依赖领取A01或B01；不要一口气实现20张任务。
每张任务：复述验收 -> 建失败测试 -> 实现纵向功能 -> 真链路验证 -> 留交接记录。
不把Mock标真模型，不把结构校验标数学验证，不把原题完成标学会。
不得引入独立Python/FastAPI服务，不得缩随机池或删除核心功能来赶工。
遇到题库/密钥/安装权限缺失，写blocked_external并继续可独立完成部分；不要伪造。
任务完成需输出修改文件、真实执行命令、AT结果和证据路径、遗留项与下一任务。
```

若只有历史POPO网页或附件，不能作为qisi-3.1基线；先从develop取得当前qisi-sdd-v3.zip，核对manifest.baseline；无仓库权限时向发起人索取本版文件，只阻塞机器契约相关实施。本文中的任务卡足够确定先做什么，但不允许用人工摘录代替严格Schema后声称契约验收通过。

## 3. A/B分工与协作

- A：公共Web/持久化/渲染基础；题库、手写输入、独立检验、AssessmentAgent、证据报告、历史/删除、部署。A也是全局依赖与数据库迁移负责人。
- B：领域契约、工作流内核；Preparation/Diagnosis/StrategyAgent、Renderer/Guard；教学页、动态路线、教师依据、教学评测。B是提示版本与教学质量负责人。
- 两人都交付组件+服务端函数+存储接线+测试，不是A画页面、B写接口。各自先用FixtureProvider跑稳定链路，再接同一ModelPort做真实联调。
- shared/types与StorePort在D1首两小时冻结。A owns package/config/db；B owns contracts/model/workflow。B需要新增依赖先给A变更请求。跨目录修改通过handoffs记录并由owner合入。
- 每日一次短合同步、一次共同真实Web走查；共同验收不等于重复计算人日。D9/D10含返工缓冲，若P0未过则顺延，不裁功能。

## 4. 页面级PRD

### P01 题库页 /bank（A02）

入口：应用首页跳/bank。列表含题号、来源、主题、题干摘要、图、ready/needs_review/invalid。用户可指定或随机。标题明确显示题库版本和当前选题范围；默认全量。

状态：加载、空库、导入失败、正常、准备中、待核对、缺图。空库提示“尚未导入比赛题库”，可切“自拟演示夹具”但需明显标注，不暗替换。准备失败显示“题号X仍被选中，尚不能可靠讲解”，重试仍针对原题。

教师导入：上传主办方题库文件与图片、预检异常、确认入库。支持规范JSONL和针对实际来源的适配器，错误记录可下载；每批不因错误丢弃整库的正确记录，错误题以invalid可见。没有原始题库时A02写导入契约+自拟fixture，但全题库验收not_run。

### P02 学习页 /learn/[sessionId]（B03/B05，输入组件A03）

默认第一句：“你准备从哪里入手？可以写计划、已有步骤，或告诉我目前不知道哪里。”不先列完整教师路线。

左侧题干/图与当前小问；中间学生输入与已核对教师输出；右侧当前目标、学生/老师/共同完成标识、已发生的学习记录。进度不用“完成台阶/总台阶百分比”冒充掌握程度。

操作：attempt、hint、explain、worked_solution、propose_route、skip_goal、reveal_route、finish_problem。propose_route支持自由文本；skip_goal需产物核对，不按按钮自动pass；reveal_route先提示“这会展示建议思路并记录帮助”。用户可随时解释/详解，不被无限提问困住。

提交中锁同会话并发，保留编辑器草稿；只流阶段，不流未校验文本。超时提供重新尝试（新request_id、同任务/冻结输入）或保留现状，不能自动丢输入/重抽题。

### P03 输入与手写确认（A03）

文本编辑器支持Markdown和LaTeX预览；老师同样使用安全渲染。禁任意HTML、javascript链接、可执行LaTeX；公式坏了显示原文错误提示而非崩溃。

一次一张JPEG/PNG/WebP，≤8MB/20MP。缩略图/上传/识别/逐行核对/确认/修改全过程可见。uncertain行需显式确认或修正；转写只忠实读图，不替学生纠正数学。原图私有，24小时清理。

独立检验的计划和答案也支持同样手写确认，但转写阶段不提供数学正确性反馈；确认文字作为plan_md/answer_md进入锁定流程。识别模型只读图片和忠实转写指令，不读该检验rubric。

### P04 独立检验 /learn/[sessionId]/check（A04/A05）

开始提示：“先写计划再作答；提交前我不会提示对错。你随时可以求助，但本次将记为带帮助。”

阶段1 check_plan：只显示题干、计划输入和“提交计划/暂时没有计划”。阶段2 check_answer：计划只读、答案可编辑；允许返回查看题干，不可改写首个计划。final提交一次后冻结，即使评分失败也不开放修改后重算首次独立成绩。

请求帮助立即记录assistance_requested，切到同题教学；模型失败时说明“已请求帮助，尚未发出提示”，不得假记help_exposed。最终带帮助作答可提交，但独立资格不恢复。

无核对可用任务显示“暂时没有可可靠检验的新任务”，原题报告可看但不得显示已验证学会。

### P05 报告、历史与新任务重测（A05/A06）

报告四块：原题完成与帮助；本次独立规划；本次独立执行；还需要验证什么。具体引用“你这次自己建立了变量约束”，不写“建模能力90分”。同任务帮助/作废/unknown和未答明确显示。

重测必须新task_hash、未见equivalence_group、verified、relation=near_transfer。只换数值标near_duplicate，不作迁移证据。无可用新题则NOT_READY，不复制旧题换ID。延迟表现默认not_evaluated。

/history恢复本匿名用户保留期内会话。主动删除二次确认；删除相关历史会标history_incomplete，不能用删除洗白已见条件；清cookie或外部帮助无法监控，报告保留边界。查看历史不能暴露未开始检验的答案。

### P06 教师页 /teacher（B06）

独立登录+会话授权，只读已发生教学依据；点击打开前提示当前任务曝光并确认。展示真实输入引用、候选解释、发送前预存探针分支、选择的干预、支架等级、实际披露、学生后续表现、失效/修订标记、实际模型/提示/耗时。

不展示模型隐藏chain-of-thought、不打印内部系统提示、不把漂亮流程图当真实节点记录。隐藏按钮不算权限；prefetch禁用。正式题库准备/修复入口走同一teacher权限。

## 5. 多Agent实现契约

产品的四个Agent为Preparation、Diagnosis、Strategy、Assessment，另有Renderer和Guard模块。每个必须独立目录、提示版本、输入输出Schema和回归测试；同一个模型可兼任不同角色。它们是受控工作流，不是自由群聊。

| 单元 | 输入最小集 | 结果最小集 | 所有者 |
| --- | --- | --- | --- |
| Preparation | mode、Problem、reference_material、student_route/evidence | Packet或RoutePatch：决策/路线/核对/任务池 | B02 |
| Diagnosis | 当前任务图、confirmed evidence及revision、先前假设/探针 | judgment、focus_goal、hypotheses/evidence、probe候选、已满足决策 | B04 |
| Strategy | Diagnosis、用户动作、曝光/预算、核对路线补丁 | 七类intervention、L0–L4、allowed/reserved、expected_artifact、理由 | B05 |
| Assessment | 核对CheckTask、locked_plan、final_answer | planning/execution四值判断、证据与unknown，不含independent布尔 | A05 |
| Renderer | 公共题干/历史、approved facts、当前问句与动作 | text_md，中文+LaTeX | B03 |
| Guard | 模式、candidate、核对依据、allowed/reserved | accept/revise/unknown、实际披露、数学问题 | B03/B07 |

每个输出先严格schema校验，额外字段拒绝。修复最多一次且计全工作流预算。所有模型输入里的学生文本/题库文本均当数据，不可覆盖系统规则。模型无任意执行代码、联网、改权限、写数据库工具。

主链路：确认输入→Diagnosis→必要时route_review→Strategy→代码PolicyGate→Renderer→Guard→短事务提交。Guard拒绝最多一次重写+再Guard，仍失败中性提示。Assessment链路隔离旧诊断画像，结果由代码再算独立资格。

默认 LangGraph.js Graph API（不是候选）+ MySQL 8.4 LTS checkpoint/节点日志。AI SDK Core封装在ModelPort，只处理模型I/O，不启用第二套自动Agent循环。业务状态提交由StorePort.commitChecked和PolicyGate负责，不由图checkpoint代替。四角色仍独立契约/上下文/提示与回归。MySQL saver为项目自有薄适配器，A01/B01必须通过恢复门禁后才能称已集成，见contracts/workflow-persistence.md。

## 6. 台阶、诊断和干预规则

1. 备课拆关键决策而非运算行；路线内AND前提无环，多路线OR；每个节点含稳定goal_key、目标、学生产物、验收、条件和来源。
2. 学生先交自己的计划；有效异解核对后采纳；未知先待定，不因不在标准解而判错。
3. 诊断先区分数学正确性与错误原因。至少保留可竞争的概念/执行/策略等解释；当证据已充分也允许一个有证据的解释，不强造竞争。
4. 探针发送前必须记录expected/counter_evidence/next_action；同canonical goal最多两次，动态节点不重置预算。
5. 七类教学：condition_check、goal_backchain、representation_bridge、prior_result_bridge、counterexample、error_localization、worked_fade。按证据选，不随机轮播模板。
6. L0自我解释、L1关注点、L2桥梁、L3局部示范、L4完整解法；任何级别都可能披露策略，实际检查记账。
7. 学生有连续有效自主产物时尝试降低支架；遇困难适当恢复。强求“少提示”导致无效猜测不算好教学。
8. 人机共同路线记coauthored；教师给出的关键决定不能归功为学生独立规划。

## 7. 状态、持久化和故障处理

状态：preparing→study；study/summary→check_plan→check_answer→summary；检验求助→study且active_task不变；修订→study并作废依赖；删除撤销所有在途提交权。

所有mutation带session_id、expected_version、request_id（转写确认按transcript revision）；owner从cookie取。相同request同payload回旧结果，异payload冲突；旧version冲突；一个session同时只运行一个workflow。JSON/SQL私有字段不传客户端。

持久化的最小对象：Problem/Packet、SessionState、Submission/revision、TraceStep、Exposure、DecisionEvidence、CheckAttempt、Request/Run/NodeRun、SeenTask、TeacherGrant。精确字段见附件48类Schema和database.sql。事务不能跨模型调用持锁。

输出、state/version、事件、实际披露、请求安全响应同事务commit后才返回。未知远程调用重试可能重复收费，不能声称exactly-once模型调用；本地状态保证幂等。进程重启复用相同hash/model/prompt的已完成节点，过期/删除lease不提交。

预算：turn正常4最多7调用/90秒；prepare正常2最多4/180秒；vision正常1最多2/45秒；grade正常2最多3/60秒。所有重试共用预算，默认并发模型调用4。不能流未检查token。暖轮p50≤15秒、p95≤35秒是待测目标，不是已达结果。

修订不抹掉真实帮助；求助请求不等于帮助真的发出。两种状态分别持久化。24h清原图/临时稿；7d清会话文本。主动删除级联、迟到结果不复活。部署为一个Node应用实例 + MySQL 8.4数据库服务 + 私有媒体卷；数据库服务不是独立业务后端。首版不部署多应用副本，不使用无持久介质的serverless执行恢复器。MySQL保存业务及checkpoint，图片放私有媒体卷。

## 8. SDD开发协议与必要脚本

SDD在这里不是只生成需求文档，而是每张卡走“规格→测试→实现→验证→证据→交接”。

- Specify：读需求FR、任务卡、AT、Schema、状态规则；创建changes/[task].md列不变量、写集和风险。
- Test first：先建立AT对应失败测试/人工验收脚本，保留初次实际失败结果。无法自动化的模型/人工判例写清输入和oracle，不写虚假的红绿截图。
- Implement：按垂直功能把UI、服务端、状态、模型adapter接到同一Web；无条件改测试去迁就错误实现不允许。
- Verify：typecheck、单元/契约/集成、对应Web E2E、必要真实模型/人工核对；静态规格验证不是应用测试。
- Evidence：每个AT使用result-template.json写commit、题库/模型/提示版本、输入/输出证据、真实命令和结果。not_run/partial/blocked不能改写成passed。
- Handoff：列改动文件、公共类型变更、迁移、环境变量、失败项和下张任务依赖；另一人复核后才完成。

A01负责建立命令：npm run dev/build/start/typecheck/lint/test/test:e2e/test:task/test:e2e:task/eval:roles/eval:teaching/bank:audit/release:check。任务卡内test:task和test:e2e:task不是现在已存在的命令，它们是A01必须实现的脚本契约；测试按AT ID登记，不允许0测试退出0来假装通过。

D1真实模型准入：配置MODEL_BASE_URL、MODEL_API_STYLE、MODEL_API_KEY、MODEL_TEXT_ID、MODEL_VISION_ID；实际可选供应商由比赛token决定，不猜一个模型名。ModelPort屏蔽协议差异，B01至少实现一个实际可用provider和FixtureProvider。必须探测文本、结构化JSON或可验证JSON输出、视觉输入、usage和取消/超时；供应商不支持原生JSON Schema可用服务端验证+一次修复。缺密钥时Mock开发可继续，真实模型验收blocked_external。

## 9. 可复用组件与准入

通用组件优先复用，教学状态/判断自研。确定选Next.js 16/React 19/TypeScript/Node 24 LTS、Tailwind CSS/shadcn/ui、LangGraph.js Graph API、AI SDK Core、MySQL 8.4 LTS/mysql2、react-markdown+remark-math+rehype-katex/KaTeX、Zod、sharp、Vitest、Playwright。具体仓库和证据等级见reuse.md；react-markdown/KaTeX已有本地README与许可核验材料，其余新选型尚需安装/兼容/许可/安全检查，不声称本轮联网核验成功。

A01/D2锁实际兼容版本和package-lock、Node版本，生成reuse-lock.json和artifacts/reuse证据。未锁版本、未运行烟测不标accepted。禁止为了用上开源而fork不匹配的完整教学Demo；SocraticAI/诊断Skill只借鉴，LangGraph.js为基线编排库，OCR/Python/CAS额外服务不默认引入。

## 10. 验收与发布策略

60项AT是P0验收套件，明确unit/integration/e2e/model_review/manual分层。结构与状态自动化；数学、探针区分力、过提示和真实教学体验还需人工审核。严重数学错误、私有答案泄露、独立性洗白任何一项出现即阻断发布，不能用平均分覆盖。

题库：全量清单核对；正式库按主题分层随机至少12题或不足12时全量；抽样规则在看结果前冻结，准备失败计入分母。没有官方题库不得用自拟夹具冒充已完成AT50。

教学：真实模型执行固定行为脚本及角色正反用例；强苏格拉底基线与完整系统同模型/题干/总预算，统计诊断、无效追问、过提示、独立性误标、unknown和成本。可追加去掉角色隔离的消融，但不能用模拟学生断言真人学习提升。

真人：有授权可做2–4人可用性和近任务观察，没有则not_run且不作学习效果结论。它不是在10天内证明长期提分的强制因果实验；发布闸门要求正确声明此边界，不要求捏造实验。

约10天是资源计划。核心P0欠缺时顺延；可以减少动画、卡片装饰和非核心仪表盘，但不能把随机题、手写、四Agent、独立检验、七干预、历史修订等静默降成“后续”。

## 11. 外部依赖和首次启动清单

需要人类提供：主办方题库样本及完整文件/授权来源；有效模型token与接口文档；部署机器/域名或本地演示环境；若做真人观察，受试者授权。A/B是职责代号，实际姓名待项目方指定，不阻塞编码。

可执行顺序：解压本包→检查README/AGENTS→运行规格静态校验→A01/B01并行→每日按depends_on领取下一卡→每晚一个可跑版本→D8实测→D9修复→D10发布闸门。若仅有一个AI，按拓扑顺序交替A01、B01、A02、B02……，同样遵守写集和交接，不需要真的启动两个进程。

以下附录由tasks/requirements/acceptance机器文件同步生成，实施时不得只改正文不改机器契约。
<!-- GENERATED_APPENDIX -->

## 附录A｜18条需求与完整追溯

| ID | 核心要求 | 实施/复验任务 | AT |
| --- | --- | --- | --- |
| FR01 全栈Web和可重现启动 | 同仓单体、A/B按垂直功能交付；非独立前后端服务。 | A01, B01, A10 | AT01, AT58 |
| FR02 全题库任意/随机选题 | 完整范围可见、来源可追、失败不缩池重抽。 | A02, A08 | AT02, AT03, AT04 |
| FR03 核对教学包与路线 | AND前提/OR路线、版本与核对、检验任务池；结构通过不等于数学正确。 | A02, B02, A08, B09 | AT05, AT06, AT07 |
| FR04 Markdown与LaTeX | 学生编辑预览、教师安全渲染，公式失败保留原文。 | A01, A03 | AT08 |
| FR05 手写确认与修订 | 忠实逐行转写，确认后才诊断，修订保留历史并失效依赖。 | A03, B04, B06 | AT09, AT11, AT12 |
| FR06 受控多Agent | 四角色独立契约/上下文/提示/回归，代码掌管状态与权限。 | B01, B02, B03, B07, B10 | AT13, AT14 |
| FR07 学生路线与动态台阶 | 先自主计划、有效异解接受、跳阶有证据、补偿节点和来源记录。 | B03, B05, B09 | AT15, AT16, AT17, AT18, AT60 |
| FR08 证据驱动诊断 | 竞争假设、预先保存探针分支、反证更新、规范目标两探针上限。 | B04, B08, B09 | AT19, AT20, AT21, AT22, AT23 |
| FR09 七类干预与撤架 | 最小必要帮助、支架渐退、学生主动详解、关键决定归属。 | B05, B08, B09 | AT24, AT25, AT26 |
| FR10 输出守卫与实际曝光 | 受限表达上下文，检查后显示，实际披露记账，未知不放行。 | B03, B05, B06, B07, B09 | AT27, AT28, AT29 |
| FR11 未见新任务独立检验 | 先锁计划后作答、首次记录、无中途反馈、求助与实际帮助分开。 | A04, A05, A08 | AT30, AT31, AT32, AT33, AT59 |
| FR12 真正新任务重测 | 跨会话已见/等价记录、未见核对任务重测，不洗白旧帮助。 | A04, A06 | AT34, AT35 |
| FR13 证据报告与历史 | 规划/执行分判，历史可恢复，无掌握百分比或未证实提分。 | A05, A06, A09 | AT36, AT37, AT38 |
| FR14 教师教学依据 | 单独鉴权、显式打开计曝光、证据链与节点状态，不披露隐藏思维链。 | B06, B10 | AT39, AT40, AT41 |
| FR15 运行恢复和预算 | 幂等、版本、节点日志、重启续跑、迟到撤销、总调用/时间/token上限。 | A01, B01, A07, B07 | AT42, AT43, AT44, AT45 |
| FR16 安全与隐私 | 服务端隔离、归属、Origin、私有图片、TTL、删除、注入防护。 | A01, A03, A06, A07, B07, A10 | AT10, AT46, AT47, AT48, AT49 |
| FR17 质量回归和比较 | 真实题库抽查、角色/全链路回归、强基线同预算、分母和未知公开。 | A08, B08, A09, B09, B10 | AT50, AT51, AT52, AT53, AT57 |
| FR18 可交付部署与演示 | 完整P0闭环、部署恢复、实际模型烟测、现场分支和未完成声明。 | A07, A09, A10, B10 | AT54, AT55, AT56 |

## 附录B｜A/B逐张SDD任务卡

每卡约1人日基准；D1/B01的适配风险可延伸到D2，门禁不过不降低标准。每张卡完成包含纵向Web功能及验收。ST是新增技术门禁，不能替代原60项AT。

### A01｜D1｜全栈脚手架、持久层和公共渲染（A，约1人日）

前置：无，D1契约先约定。需求：FR01, FR04, FR15, FR16。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md, acceptance/stack-cases.json。

独占写集：`package.json`, `package-lock.json`, `src/app/layout.tsx`, `src/shared/**`, `tests/shared/**`, `tests/e2e/smoke.spec.ts`, `next.config.*`, `tsconfig.json`, `vitest.config.*`, `playwright.config.*`, `.nvmrc`, `.node-version`, `.env.example`, `.gitignore`, `.dockerignore`, `Dockerfile`, `compose.yaml`, `eslint.config.*`, `postcss.config.*`, `components.json`, `src/app/page.tsx`, `src/app/globals.css`, `src/components/ui/**`, `src/lib/utils.ts`, `src/lib/db/**`, `migrations/**`, `scripts/db/**`, `scripts/tests/**`, `scripts/seed/**`, `tests/integration/db/**`, `artifacts/reuse/**`。

实施顺序：
1. 读取ADR-001，在qisi-dashboard仓库根建立Next.js 16/React 19/TypeScript/Node 24 LTS应用；保留frontend/backend，不删除历史骨架。
2. 安装并精确锁定全部选定依赖，初始化Tailwind CSS/shadcn/ui；提交package-lock、Node版本和依赖准入证据。
3. 建立MySQL 8.4 Compose、健康检查、独立持久卷及迁移脚本；mysql2连接池设置UTC/utf8mb4/READ COMMITTED，检查默认认证与生产TLS。
4. 实现匿名owner、MySQL StorePort、请求幂等/版本/CAS与短事务；由A统一合入B提出的checkpoint表迁移。
5. 实现MathMarkdown、安全DTO与Web骨架；用FixtureProvider跑页面→图→校验→MySQL→刷新链路，并协同B验证杀进程续跑。

先失败后通过的验收：
- AT01: 页面/服务端同进程；已提交安全响应从磁盘恢复
- AT08: 安全显示正常公式；坏公式保留原文不白屏
- AT58: reuse-lock有精确版本和证据；没跑不标accepted
- ST01: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST02: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST03: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST04: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run

技术门禁：ST01, ST02, ST03, ST04。

验证命令：
```text
npm run typecheck
npm run test:task -- A01
npm run test:e2e:task -- A01
npm run build
npm run db:migrate
npm run test:db
npm run test:stack -- A01
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A01.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B01｜D1｜领域契约、四Agent壳和工作流内核（B，约1人日）

前置：无，D1契约先约定。需求：FR01, FR06, FR15。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md, contracts/workflow-persistence.md, contracts/mysql.md, acceptance/stack-cases.json。

独占写集：`src/contracts/**`, `src/agents/**`, `src/workflows/**`, `src/prompts/**`, `tests/agents/**`, `tests/workflows/**`, `docs/adr/001-orchestration.md`, `src/model/**`, `tests/model/**`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 与A先冻结共享契约及MySQL迁移接口；业务Schema映射严格Zod，跨字段PolicyGate由代码执行。
2. 实现Preparation/Diagnosis/Strategy/Assessment四Agent独立入口及Renderer/Guard；Assessment业务实现仍归A。
3. 用LangGraph.js StateGraph定义有界节点/分支，应用统一预算器；关闭SDK隐式重试和图自动节点重试，不启用第二套Agent循环。
4. ModelPort封装AI SDK Core与具体provider adapter，实现FixtureProvider及真实文本/结构化/图片/取消/usage能力探测；依赖由A锁定。
5. 按workflow-persistence.md实现MySqlCheckpointSaver薄适配；run_id作thread_id，checkpoint不替代node_runs审计或最终业务事务。
6. 与A联测MySQL checkpoint读写、pending writes、刷新/杀进程恢复；独立commit前再次校验lease/版本/期限，不能只用MemorySaver验收。

先失败后通过的验收：
- AT13: 真实经过对应独立契约与提示节点，不是一调用伪造四阶段
- ST05: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST06: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST07: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run

技术门禁：ST05, ST06, ST07。

验证命令：
```text
npm run typecheck
npm run test:task -- B01
npm run test:e2e:task -- B01
npm run test:stack -- B01
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B01.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A02｜D2｜全量导入、选题和准备状态Web（A，约1人日）

前置：A01, B01。需求：FR02, FR03。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/features/bank/**`, `src/app/bank/**`, `src/app/api/bank/**`, `tests/bank/**`, `tests/e2e/bank.spec.ts`。

实施顺序：
1. 读取主办方实际样本，建立JSONL+私有题图导入适配器和异常清单。
2. 实现题库页指定/随机选择，持久化全范围哈希及抽中ID。
3. 接入prepare工作流，冷启动显示原题准备与可重试状态。
4. 证明needs_review/invalid不被静默剔除，刷新不重抽。

先失败后通过的验收：
- AT02: 候选ID集合含全部题；异常保留选中ID，不隐式重抽
- AT03: 命中同一次选题记录；池哈希及题库版本相同
- AT04: 逐项异常计数可追原始记录；不伪称全部就绪

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- A02
npm run test:e2e:task -- A02
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A02.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B02｜D2｜备课Agent、核对、图与检验任务池（B，约1人日）

前置：B01, A01。需求：FR03, FR06。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/agents/preparation/**`, `src/workflows/prepare.ts`, `src/features/preparation/**`, `src/prompts/preparation.md`, `tests/preparation/**`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 实现prepare和route_review双模式；主路线与可选异解的AND/OR图。
2. 按problem_hash+prompt/model/config版本缓存并记录数学核对来源。
3. 生成至少两项检验候选，未核对项不得启动检验。
4. 实现包核对Guard、循环/引用/条件/缺图负例，不以双模型一致当证明。

先失败后通过的验收：
- AT05: 拒绝并保留needs_review；结构不充当数学认证
- AT06: 旧hash包失效；prepare结果绑定新hash/版本
- AT07: 不自动认证；出现冲突needs_review及问题记录

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- B02
npm run test:e2e:task -- B02
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B02.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A03｜D3｜手写上传、确认和输入组件（A，约1人日）

前置：A01, B01。需求：FR04, FR05, FR16。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/features/media/**`, `src/app/api/media/**`, `src/features/input/**`, `tests/media/**`, `tests/e2e/media.spec.ts`。

实施顺序：
1. 校验文件大小类型真实解码并存私有映射。
2. 实现VisionPort忠实逐行转写与不确定标记。
3. 建立草稿编辑、确认、重新上传和Markdown预览组件。
4. 提交confirmed revision给教学，不把OCR纠错当学生数学能力。

先失败后通过的验收：
- AT09: 忠实转写不改答案；未确认不可教学或评分
- AT10: 拒绝危险文件或NOT_FOUND；私有文件无公开URL
- AT11: 记录确认revision后才生成Submission；重复确认幂等

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- A03
npm run test:e2e:task -- A03
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A03.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B03｜D3｜真实教学轮与可见页面（B，约1人日）

前置：B01, B02, A02。需求：FR06, FR07, FR10。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/features/tutor/**`, `src/app/learn/[sessionId]/page.tsx`, `src/workflows/turn.ts`, `src/agents/renderer/**`, `src/agents/guard/**`, `src/prompts/renderer.md`, `src/prompts/guard.md`, `tests/tutor/**`, `tests/e2e/tutor.spec.ts`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 实现attempt/hint/explain/worked_solution/finish_problem动作。
2. 诊断策略表达守卫按独立入口串接，Guard通过才事务提交显示。
3. 学习页先自主输入，只显示当前必要目标，接A输入组件。
4. 完成一条真模型文本链路与失败中性回退，明确记录真实provider版本。

先失败后通过的验收：
- AT14: 记录实际诊断/策略/表达/检查调用、版本/费用；非Mock
- AT15: 只展示题干与自主输入，不预先泄露完整步骤
- AT27: 不含完整解法、未来rubric和私有诊断原文

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- B03
npm run test:e2e:task -- B03
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B03.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A04｜D4｜独立检验状态与计划锁定页面（A，约1人日）

前置：A02, B02, A03。需求：FR11, FR12。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/features/assessment/**`, `src/app/learn/[sessionId]/check/**`, `tests/assessment/**`, `tests/e2e/assessment.spec.ts`。

实施顺序：
1. 构建owner级已见/等价登记与首次attempt表。
2. start锁定任务，submit_plan锁计划并开放答案区，finish后评分。
3. 实现不提示的草稿保存和help先持久assistance_requested。
4. 新任务与求助学习保留任务ID，刷新不能重置首次资格。

先失败后通过的验收：
- AT30: 先锁计划，无中间对错反馈，最终才独立分判
- AT31: owner级首次/已见记录继续存在，不能洗白
- AT32: assistance_requested=true，help_exposed=false；不能独立通过

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- A04
npm run test:e2e:task -- A04
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A04.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B04｜D4｜证据诊断和有区分力的探针（B，约1人日）

前置：B03, A03。需求：FR05, FR08。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/agents/diagnosis/**`, `src/prompts/diagnosis.md`, `src/features/tutor/evidence.ts`, `tests/diagnosis/**`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 实现valid/invalid/unknown与原因独立判定。
2. 引用当前有效confirmed evidence，预先持久分支与反证。
3. 按规范goal_key限制两探针，禁止换节点名重置。
4. 实现同错不同因、已会不教、反证修订与输入歧义回归。

先失败后通过的验收：
- AT19: 分别支持concept与execution并改变后续教学
- AT20: 定位strategy连接，不重复教授导数
- AT21: 服务端拒绝；不把虚构引用写入trace
- AT22: 按canonical goal计数拦截；选择解释/低风险帮助/待定
- AT23: 显示前已保存expected/counterevidence/next_action；不事后改预期

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- B04
npm run test:e2e:task -- B04
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B04.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A05｜D5｜独立评分接线与证据报告（A，约1人日）

前置：A04, B03。需求：FR11, FR13。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/agents/assessment/**`, `src/prompts/assessment.md`, `src/features/assessment/grade.ts`, `src/features/report/**`, `src/app/learn/[sessionId]/report/**`, `tests/report/**`。

实施顺序：
1. 实现独立AssessmentAgent上下文，只拿锁定计划/最终产物与rubric。
2. 评分加Guard复核，冲突/失败unknown，规划执行分判。
3. 代码推导独立性与原题完成，不让模型自设passed。
4. 报告显示帮助请求但未发出、未测、已作废等边界。

先失败后通过的验收：
- AT33: 规划执行分别报告，整题不算独立通过
- AT36: 原题incomplete/unknown，不把点击当数学正确
- AT37: 独立通过为false并保留真实原因；无掌握百分比
- AT59: 禁止额外字段和旧画像；独立性只由代码计算

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- A05
npm run test:e2e:task -- A05
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A05.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B05｜D5｜七类策略、动态台阶与路线归属（B，约1人日）

前置：B04, B02, A04。需求：FR07, FR09, FR10。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/agents/strategy/**`, `src/prompts/strategy.md`, `src/features/tutor/route.ts`, `src/features/tutor/ladder.ts`, `src/workflows/policy.ts`, `tests/strategy/**`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 实现七类intervention和L0-L4，显式详解优先。
2. 实现student/teacher/coauthored路线与route_review核对后补丁。
3. 自主有效产物可跳阶，连续两次有效尝试降低支架候选。
4. PolicyGate校验披露/保留、预算、引用，拒绝被提示伪装独立。

先失败后通过的验收：
- AT16: 接受合法异解并保留student来源；单调性缺口另行指出
- AT17: 不因不匹配判错，也不盲目接受；unknown/局部核对
- AT18: 有证据跳过已会节点，不强迫逐阶问答
- AT24: 每种至少一正例一误用负例；动作与证据匹配
- AT25: 不强制答错；获准且核对后解释并按实际披露记账
- AT26: 尝试降支架但保留关键条件；遇失败可恢复不羞辱学生
- AT60: 数学依赖无环，source及canonical目标保留；教学重试另存

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- B05
npm run test:e2e:task -- B05
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B05.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A06｜D6｜真正新任务重测、历史与隐私删除（A，约1人日）

前置：A05, B05。需求：FR12, FR13, FR16。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/features/assessment/reassess.ts`, `src/features/history/**`, `src/app/history/**`, `src/shared/retention.ts`, `src/shared/delete.ts`, `tests/history/**`, `tests/e2e/privacy.spec.ts`。

实施顺序：
1. 重测选择经过核对且owner未见的新任务，等价/近重复单列。
2. 实现历史会话、报告链接和实际曝光归属。
3. 实现24h图片/7d文本清理与主动删除级联撤销run。
4. 记录未做延迟测验而非补一个虚假长期掌握值。

先失败后通过的验收：
- AT34: 不重命名复用；另选未见核对非等价任务或NOT_READY
- AT35: 标near_duplicate，不能冒称迁移证明
- AT38: 只见自己会话，已记录帮助仍在；跨owner返回NOT_FOUND
- AT47: 先仅删图片/临时稿，再按会话级联删文本/事件；题库不受影响

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- A06
npm run test:e2e:task -- A06
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A06.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B06｜D6｜输入修订与教师决策依据（B，约1人日）

前置：B04, B05, A05。需求：FR05, FR10, FR14。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/features/tutor/corrections.ts`, `src/features/teacher/**`, `src/app/teacher/**`, `tests/teacher/**`, `tests/corrections/**`, `tests/e2e/teacher.spec.ts`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 修订保留旧/新输入与依赖失效，不抹实际帮助。
2. 教师独立cookie/限流/授权，打开当前trace先计whole_task曝光。
3. 展示证据/候选/探针/动作/后续观察与真实节点记录，不展示隐藏CoT。
4. 学生历史只读安全摘要，教师页不预取未来解法。

先失败后通过的验收：
- AT12: 旧结论及依赖标invalidated，曝光不减少，首次记录不重置
- AT29: 以actual_disclosed_ids/whole_task记账，不按按钮级别豁免
- AT39: 服务端拒绝，不仅隐藏按钮
- AT40: 先计当前task whole_task曝光再返回；未来rubric无泄露，无预取
- AT41: 包含证据、竞争假设、已预存探针、动作理由和后续更新；不含隐藏CoT

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- B06
npm run test:e2e:task -- B06
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B06.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A07｜D7｜存储故障、归属和部署纵向加固（A，约1人日）

前置：A06, B06。需求：FR15, FR16, FR18。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md, acceptance/stack-cases.json。

独占写集：`src/shared/**`, `tests/shared/**`, `tests/security/**`, `tests/e2e/recovery.spec.ts`, `Dockerfile`, `.dockerignore`, `scripts/start-production.*`, `docs/deploy.md`。

实施顺序：
1. 并发、相同request不同payload、旧版本和跨owner测试。
2. 提交后断网复用结果，删除中回调不可复活。
3. MySQL 8.4与私有媒体卷备份/恢复；单Node实例+数据库服务部署，故障期间拒绝成功响应，不自动降级内存数据库。
4. 安全扫描RSC/HTML/网络、私有图访问与Origin。

先失败后通过的验收：
- AT42: REQUEST_CONFLICT/VERSION_CONFLICT/BUSY；只一次有效提交
- AT44: 返回原安全响应；曝光保持，不重复增加turn
- AT46: lease失效不可提交，不重建已删除会话
- AT48: 私有值不出现；Origin/归属检查；日志无明文凭据
- ST08: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST09: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST10: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST11: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run

技术门禁：ST08, ST09, ST10, ST11。

验证命令：
```text
npm run typecheck
npm run test:task -- A07
npm run test:e2e:task -- A07
npm run test:db
npm run test:stack -- A07
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A07.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B07｜D7｜工作流恢复、预算和守卫攻击回归（B，约1人日）

前置：B06, A06。需求：FR06, FR10, FR15, FR16。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md, acceptance/stack-cases.json。

独占写集：`src/workflows/**`, `src/agents/guard/**`, `tests/workflows/**`, `tests/guard/**`, `tests/agents/security.test.ts`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. LangGraph/MySQL checkpoint结合node_runs/input/model/prompt哈希恢复；覆盖checkpoint写前后、领域commit前后杀进程，验证只一次有效提交。
2. 所有模型尝试计全局call/token/time预算，最多一次schema修复和文本重写。
3. 执行提示注入、私有答案泄露、假证据与越权角色负例。
4. 确认中性fallback不生成虚构曝光，正常消息也先检查后显示。

先失败后通过的验收：
- AT28: 最多一次重写；中性fallback；未经检查内容不进入HTTP流
- AT43: 已完成同hash节点复用；活动lease检查；可能重计费如实记录
- AT45: 硬截止中止；所有尝试共享预算；不绕开守卫
- AT49: 内容不能改系统指令/调用工具/执行脚本；危险链接禁用
- ST06: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST07: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST08: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST09: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST12: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run

技术门禁：ST06, ST07, ST08, ST09, ST12。

验证命令：
```text
npm run typecheck
npm run test:task -- B07
npm run test:e2e:task -- B07
npm run test:stack -- B07
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B07.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A08｜D8｜全题库审计与端到端验证（A，约1人日）

前置：A07, B07。需求：FR02, FR03, FR11, FR17。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`scripts/bank-audit.*`, `scripts/evaluate-app.*`, `tests/e2e/**`, `artifacts/eval/bank/**`, `artifacts/eval/e2e/**`。

实施顺序：
1. 全量统计题目/缺图/准备/核对状态分母，确认抽题范围。
2. 按主题分层随机抽取不少于12题或小题库全量，保留失败样本。
3. 对每题执行真实会话与独立检验或记录未就绪原因。
4. 输出UI/延迟/成本/输入故障报告，不用只跑自拟题代替题库验收。

先失败后通过的验收：
- AT02: 候选ID集合含全部题；异常保留选中ID，不隐式重抽
- AT04: 逐项异常计数可追原始记录；不伪称全部就绪
- AT30: 先锁计划，无中间对错反馈，最终才独立分判
- AT50: 公开完整分母/失败/未就绪/未覆盖，不能只挑成功题

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- A08
npm run test:e2e:task -- A08
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A08.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B08｜D8｜角色回归与强基线教学比较（B，约1人日）

前置：B07, A07。需求：FR08, FR09, FR17。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`scripts/evaluate-teaching.*`, `tests/eval/**`, `artifacts/eval/roles/**`, `artifacts/eval/baseline/**`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 冻结同错不同因等行为脚本、角色输出oracle与提示版本。
2. 同模型同题同预算比较强苏格拉底基线和完整系统，可追加合并角色消融。
3. 盲化人工核对数学/诊断/过提示/unknown，报告分母与不可比轨迹。
4. 真实模型输出与FixtureProvider报告分开，不把模拟学生当真人学习证据。

先失败后通过的验收：
- AT19: 分别支持concept与execution并改变后续教学
- AT20: 定位strategy连接，不重复教授导数
- AT24: 每种至少一正例一误用负例；动作与证据匹配
- AT51: 报告诊断/过提示/unknown/成本，不能声称统计因果或只比答案准确率
- AT52: 各角色有正反用例、独立结果；模拟与真实模型标签分开

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- B08
npm run test:e2e:task -- B08
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B08.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A09｜D9｜体验修复、验收人复查与演示路径（A，约1人日）

前置：A08, B08。需求：FR13, FR17, FR18。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/features/bank/**`, `src/features/media/**`, `src/features/assessment/**`, `src/features/report/**`, `src/features/history/**`, `tests/e2e/**`, `docs/demo.md`。

实施顺序：
1. 修复A范围P0缺陷，覆盖窄屏/键盘/空态/超时/错误恢复。
2. 交叉复验B的教师与教学输出，不跨写集直接改B代码。
3. 有授权时做2-4位学生/老师观察并单列样本限制，无授权not_run。
4. 准备随机选题、手写修订、同错不同教、撤架重测现场演示。

先失败后通过的验收：
- AT36: 原题incomplete/unknown，不把点击当数学正确
- AT38: 只见自己会话，已记录帮助仍在；跨owner返回NOT_FOUND
- AT53: 记录是否真人/授权与样本边界；未做为not_run，不伪造学会
- AT56: 所有核心功能可达；错误态不丢输入，加载状态真实

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- A09
npm run test:e2e:task -- A09
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A09.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B09｜D9｜教学质量修复和全场景回归（B，约1人日）

前置：B08, A08。需求：FR03, FR07, FR08, FR09, FR10, FR17。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md。

独占写集：`src/agents/**`, `src/prompts/**`, `src/features/tutor/**`, `src/features/teacher/**`, `tests/agents/**`, `tests/tutor/**`, `artifacts/eval/final/**`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 按失败类别修复提示/图/策略，禁止针对演示题硬编码答案。
2. 用未参与调参的保留题/脚本复验，保留旧失败证据。
3. 交叉复核A独立性和报告逻辑，有误交A修复。
4. 所有角色与全链路测试重跑，确认新增提示未退化保留决策。

先失败后通过的验收：
- AT05: 拒绝并保留needs_review；结构不充当数学认证
- AT16: 接受合法异解并保留student来源；单调性缺口另行指出
- AT19: 分别支持concept与execution并改变后续教学
- AT24: 每种至少一正例一误用负例；动作与证据匹配
- AT28: 最多一次重写；中性fallback；未经检查内容不进入HTTP流
- AT57: 无针对demo硬编码；保留失败记录并重跑关键P0

技术门禁：继承A01/B01已通过基线。

验证命令：
```text
npm run typecheck
npm run test:task -- B09
npm run test:e2e:task -- B09
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B09.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### A10｜D10｜发布冻结、部署验收和交付缓冲（A，约1人日）

前置：A09, B09。需求：FR01, FR16, FR18。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md, acceptance/stack-cases.json。

独占写集：`docs/release.md`, `docs/deploy.md`, `artifacts/release/**`, `scripts/release-check.*`。

实施顺序：
1. 从干净环境npm ci/build/启动；迁移MySQL 8.4、健康检查，恢复数据库与媒体备份并验证删除操作。
2. 逐项汇总P0测试、题库覆盖和依赖准入证据。
3. 检查密钥/手写数据不入仓库与录像，整理运行和回滚说明。
4. 仅全部发布闸门通过才标可演示，否则列明未完成和追加日程。

先失败后通过的验收：
- AT01: 页面/服务端同进程；已提交安全响应从磁盘恢复
- AT46: lease失效不可提交，不重建已删除会话
- AT48: 私有值不出现；Origin/归属检查；日志无明文凭据
- AT54: 完整Web可演示、磁盘可恢复、密钥不入客户端；缺外部条件不宣布全验收
- AT58: reuse-lock有精确版本和证据；没跑不标accepted
- ST01: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST10: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST11: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run

技术门禁：ST01, ST10, ST11。

验证命令：
```text
npm run typecheck
npm run test:task -- A10
npm run test:e2e:task -- A10
npm run test:stack -- A10
```

输出：可运行的纵向功能 + 对应测试 + handoffs/A10.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

### B10｜D10｜提示冻结、现场联测与答辩材料（B，约1人日）

前置：B09, A09。需求：FR06, FR14, FR17, FR18。

输入：README.md, AGENTS.md, prd.md, contracts/README.md, contracts/domain.schema.json, stack.json, adr/ADR-001-stack.md, acceptance/stack-cases.json。

独占写集：`docs/teaching-demo.md`, `docs/model-card.md`, `artifacts/release/teaching/**`。
排除：src/agents/assessment/**；跨公共文件由owner合入。

实施顺序：
1. 冻结model/prompt/packet版本和预算配置，提供复现命令。
2. 交叉现场抽题演示依据、故障恢复与学习证据。
3. 整理已证明/未证明能力与开源来源，不用Agent数量替代证据。
4. 与A共同签署验收清单，保留未来优化而不隐瞒核心未完成。

先失败后通过的验收：
- AT13: 真实经过对应独立契约与提示节点，不是一调用伪造四阶段
- AT40: 先计当前task whole_task曝光再返回；未来rubric无泄露，无预取
- AT41: 包含证据、竞争假设、已预存探针、动作理由和后续更新；不含隐藏CoT
- AT55: 使用实时服务或明确标注回放；答辩展示真实依据和边界
- ST05: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run
- ST12: 按stack-cases.json执行，真实MySQL/图/模型未跑明确not_run

技术门禁：ST05, ST12。

验证命令：
```text
npm run typecheck
npm run test:task -- B10
npm run test:e2e:task -- B10
npm run test:stack -- B10
```

输出：可运行的纵向功能 + 对应测试 + handoffs/B10.md。交接必须包含：changed_files, commands_and_actual_results, acceptance_status, known_failures, next_dependency。

## 附录C｜60项Given/When/Then验收

每项初始specified/not_run。测试本身和模型/人工审查结果需要分别留证，不能因为表格已经写完而标通过。


### AT01｜A01｜e2e｜FR01

- Given：空数据库与FixtureProvider
- When：启动Web提交一轮并刷新
- Then：页面/服务端同进程；已提交安全响应从磁盘恢复
- 证据：artifacts/acceptance/AT01.json；初始not_run。

### AT02｜A02｜integration｜FR02

- Given：题库有ready/needs_review/invalid
- When：依次指定各题并多次随机选
- Then：候选ID集合含全部题；异常保留选中ID，不隐式重抽
- 证据：artifacts/acceptance/AT02.json；初始not_run。

### AT03｜A02｜integration｜FR02

- Given：相同随机request_id和payload
- When：重复点击或网络重试
- Then：命中同一次选题记录；池哈希及题库版本相同
- 证据：artifacts/acceptance/AT03.json；初始not_run。

### AT04｜A02｜integration｜FR02

- Given：实际题库含重复ID、缺题图、未知格式
- When：导入并查看报告
- Then：逐项异常计数可追原始记录；不伪称全部就绪
- 证据：artifacts/acceptance/AT04.json；初始not_run。

### AT05｜B02｜unit｜FR03

- Given：包含循环依赖/越界引用/ready且blocking问题
- When：验证包
- Then：拒绝并保留needs_review；结构不充当数学认证
- 证据：artifacts/acceptance/AT05.json；初始not_run。

### AT06｜B02｜integration｜FR03

- Given：题干或图发生变更
- When：再次加载教学包
- Then：旧hash包失效；prepare结果绑定新hash/版本
- 证据：artifacts/acceptance/AT06.json；初始not_run。

### AT07｜B02｜model_review｜FR03

- Given：参考有明显数学错误或无依据
- When：备课并复核
- Then：不自动认证；出现冲突needs_review及问题记录
- 证据：artifacts/acceptance/AT07.json；初始not_run。

### AT08｜A01｜e2e｜FR04

- Given：中文Markdown、行内与块LaTeX、坏公式
- When：编辑预览和显示老师消息
- Then：安全显示正常公式；坏公式保留原文不白屏
- 证据：artifacts/acceptance/AT08.json；初始not_run。

### AT09｜A03｜e2e｜FR05

- Given：手写1+1/x²并含模糊负号
- When：上传未确认草稿
- Then：忠实转写不改答案；未确认不可教学或评分
- 证据：artifacts/acceptance/AT09.json；初始not_run。

### AT10｜A03｜integration｜FR16

- Given：伪图片/超8MB/超20MP/SVG
- When：上传或访问别人的图片ID
- Then：拒绝危险文件或NOT_FOUND；私有文件无公开URL
- 证据：artifacts/acceptance/AT10.json；初始not_run。

### AT11｜A03｜e2e｜FR05

- Given：含uncertain行的草稿
- When：逐行更正或明确确认
- Then：记录确认revision后才生成Submission；重复确认幂等
- 证据：artifacts/acceptance/AT11.json；初始not_run。

### AT12｜B06｜integration｜FR05

- Given：旧输入已引发提示和检验
- When：修订旧输入
- Then：旧结论及依赖标invalidated，曝光不减少，首次记录不重置
- 证据：artifacts/acceptance/AT12.json；初始not_run。

### AT13｜B01｜unit｜FR06

- Given：四角色入口和FixtureProvider
- When：运行prepare/turn/grade
- Then：真实经过对应独立契约与提示节点，不是一调用伪造四阶段
- 证据：artifacts/acceptance/AT13.json；初始not_run。

### AT14｜B03｜model_review｜FR06

- Given：真实模型配置与核对开发题
- When：学生提交一轮
- Then：记录实际诊断/策略/表达/检查调用、版本/费用；非Mock
- 证据：artifacts/acceptance/AT14.json；初始not_run。

### AT15｜B03｜e2e｜FR07

- Given：新会话
- When：未请求帮助前打开学习页
- Then：只展示题干与自主输入，不预先泄露完整步骤
- 证据：artifacts/acceptance/AT15.json；初始not_run。

### AT16｜B05｜model_review｜FR07

- Given：学生提供有效AM–GM最值路线
- When：提交计划和推导
- Then：接受合法异解并保留student来源；单调性缺口另行指出
- 证据：artifacts/acceptance/AT16.json；初始not_run。

### AT17｜B05｜integration｜FR07

- Given：学生路线含错误条件或未核对
- When：请求后续推进
- Then：不因不匹配判错，也不盲目接受；unknown/局部核对
- 证据：artifacts/acceptance/AT17.json；初始not_run。

### AT18｜B05｜model_review｜FR07

- Given：学生一次给出多个有效决策
- When：请求继续
- Then：有证据跳过已会节点，不强迫逐阶问答
- 证据：artifacts/acceptance/AT18.json；初始not_run。

### AT19｜B04｜model_review｜FR08

- Given：相同导数正号错误
- When：甲坚持错误规则、乙自证为抄错
- Then：分别支持concept与execution并改变后续教学
- 证据：artifacts/acceptance/AT19.json；初始not_run。

### AT20｜B04｜model_review｜FR08

- Given：正确求导但不会连接符号与单调性
- When：请老师帮助
- Then：定位strategy连接，不重复教授导数
- 证据：artifacts/acceptance/AT20.json；初始not_run。

### AT21｜B04｜unit｜FR08

- Given：存在未confirmed/voided/不存在的evidence_id
- When：诊断输出引用它
- Then：服务端拒绝；不把虚构引用写入trace
- 证据：artifacts/acceptance/AT21.json；初始not_run。

### AT22｜B04｜integration｜FR08

- Given：未解决目标已经两次探针
- When：模型改node_id再次提问
- Then：按canonical goal计数拦截；选择解释/低风险帮助/待定
- 证据：artifacts/acceptance/AT22.json；初始not_run。

### AT23｜B04｜integration｜FR08

- Given：将要显示探针
- When：学生回答前后读取事件
- Then：显示前已保存expected/counterevidence/next_action；不事后改预期
- 证据：artifacts/acceptance/AT23.json；初始not_run。

### AT24｜B05｜model_review｜FR09

- Given：七种已标注卡点样例
- When：策略选择教学方式
- Then：每种至少一正例一误用负例；动作与证据匹配
- 证据：artifacts/acceptance/AT24.json；初始not_run。

### AT25｜B05｜e2e｜FR09

- Given：用户未尝试或不愿继续探针
- When：点击解释/完整解法
- Then：不强制答错；获准且核对后解释并按实际披露记账
- 证据：artifacts/acceptance/AT25.json；初始not_run。

### AT26｜B05｜model_review｜FR09

- Given：连续两次自主有效产物
- When：进入下一目标
- Then：尝试降支架但保留关键条件；遇失败可恢复不羞辱学生
- 证据：artifacts/acceptance/AT26.json；初始not_run。

### AT27｜B03｜unit｜FR10

- Given：Renderer输入构造
- When：查看最终模型请求
- Then：不含完整解法、未来rubric和私有诊断原文
- 证据：artifacts/acceptance/AT27.json；初始not_run。

### AT28｜B07｜integration｜FR10

- Given：输出暗含保留关键答案
- When：Guard判revise后重写仍失败
- Then：最多一次重写；中性fallback；未经检查内容不进入HTTP流
- 证据：artifacts/acceptance/AT28.json；初始not_run。

### AT29｜B06｜integration｜FR10

- Given：L0文本实际暴露策略
- When：提交显示并回读报告
- Then：以actual_disclosed_ids/whole_task记账，不按按钮级别豁免
- 证据：artifacts/acceptance/AT29.json；初始not_run。

### AT30｜A04｜e2e｜FR11

- Given：有未见且核对的新任务
- When：start -> submit_plan -> answer -> finish
- Then：先锁计划，无中间对错反馈，最终才独立分判
- 证据：artifacts/acceptance/AT30.json；初始not_run。

### AT31｜A04｜integration｜FR11

- Given：独立检验途中
- When：刷新、重开原题、换会话重选同题
- Then：owner级首次/已见记录继续存在，不能洗白
- 证据：artifacts/acceptance/AT31.json；初始not_run。

### AT32｜A04｜integration｜FR11

- Given：独立检验未完成
- When：help后provider失败
- Then：assistance_requested=true，help_exposed=false；不能独立通过
- 证据：artifacts/acceptance/AT32.json；初始not_run。

### AT33｜A05｜integration｜FR11

- Given：独立规划正确但执行错/空白/未知
- When：评分并生成报告
- Then：规划执行分别报告，整题不算独立通过
- 证据：artifacts/acceptance/AT33.json；初始not_run。

### AT34｜A06｜integration｜FR12

- Given：旧任务求助或完成，候选内容近重复
- When：点击重新检验
- Then：不重命名复用；另选未见核对非等价任务或NOT_READY
- 证据：artifacts/acceptance/AT34.json；初始not_run。

### AT35｜A06｜model_review｜FR12

- Given：候选题只换数字或来自同一等价组
- When：核对新任务关系
- Then：标near_duplicate，不能冒称迁移证明
- 证据：artifacts/acceptance/AT35.json；初始not_run。

### AT36｜A05｜integration｜FR13

- Given：原题只点击完成，缺关键证明
- When：生成总结
- Then：原题incomplete/unknown，不把点击当数学正确
- 证据：artifacts/acceptance/AT36.json；初始not_run。

### AT37｜A05｜unit｜FR13

- Given：任务未知/已帮助/已作废/未答/未测
- When：计算独立性
- Then：独立通过为false并保留真实原因；无掌握百分比
- 证据：artifacts/acceptance/AT37.json；初始not_run。

### AT38｜A06｜e2e｜FR13

- Given：同owner有多个历史会话
- When：访问历史/报告
- Then：只见自己会话，已记录帮助仍在；跨owner返回NOT_FOUND
- 证据：artifacts/acceptance/AT38.json；初始not_run。

### AT39｜B06｜e2e｜FR14

- Given：学生或未授权请求teacher
- When：直接访问页及action
- Then：服务端拒绝，不仅隐藏按钮
- 证据：artifacts/acceptance/AT39.json；初始not_run。

### AT40｜B06｜integration｜FR14

- Given：教师打开当前任务依据
- When：确认openTrace并刷新
- Then：先计当前task whole_task曝光再返回；未来rubric无泄露，无预取
- 证据：artifacts/acceptance/AT40.json；初始not_run。

### AT41｜B06｜model_review｜FR14

- Given：有效教学轮trace
- When：查看教学依据
- Then：包含证据、竞争假设、已预存探针、动作理由和后续更新；不含隐藏CoT
- 证据：artifacts/acceptance/AT41.json；初始not_run。

### AT42｜A07｜integration｜FR15

- Given：相同request异payload/旧expected_version/同时提交
- When：调用mutation
- Then：REQUEST_CONFLICT/VERSION_CONFLICT/BUSY；只一次有效提交
- 证据：artifacts/acceptance/AT42.json；初始not_run。

### AT43｜B07｜integration｜FR15

- Given：模型节点完成后进程崩溃
- When：重启恢复相同run
- Then：已完成同hash节点复用；活动lease检查；可能重计费如实记录
- 证据：artifacts/acceptance/AT43.json；初始not_run。

### AT44｜A07｜integration｜FR15

- Given：响应提交后网络中断
- When：相同request重试
- Then：返回原安全响应；曝光保持，不重复增加turn
- 证据：artifacts/acceptance/AT44.json；初始not_run。

### AT45｜B07｜integration｜FR15

- Given：模型超时或call/token预算耗尽
- When：继续分支/改写/路线审查
- Then：硬截止中止；所有尝试共享预算；不绕开守卫
- 证据：artifacts/acceptance/AT45.json；初始not_run。

### AT46｜A07｜integration｜FR16

- Given：session删除/到期但provider仍在途
- When：返回模型结果
- Then：lease失效不可提交，不重建已删除会话
- 证据：artifacts/acceptance/AT46.json；初始not_run。

### AT47｜A06｜integration｜FR16

- Given：图片超过24h且文本未满7d
- When：运行清理；随后会话过期
- Then：先仅删图片/临时稿，再按会话级联删文本/事件；题库不受影响
- 证据：artifacts/acceptance/AT47.json；初始not_run。

### AT48｜A07｜e2e｜FR16

- Given：答案/密钥/未来rubric埋在服务端
- When：扫描学生HTML/RSC/props/API与跨源mutation
- Then：私有值不出现；Origin/归属检查；日志无明文凭据
- 证据：artifacts/acceptance/AT48.json；初始not_run。

### AT49｜B07｜integration｜FR16

- Given：输入含注入、HTML脚本、恶意链接/LaTeX
- When：正常教学并展示
- Then：内容不能改系统指令/调用工具/执行脚本；危险链接禁用
- 证据：artifacts/acceptance/AT49.json；初始not_run。

### AT50｜A08｜model_review｜FR17

- Given：正式题库和固定抽样种子
- When：执行全量清单+分层不少于12题抽查
- Then：公开完整分母/失败/未就绪/未覆盖，不能只挑成功题
- 证据：artifacts/acceptance/AT50.json；初始not_run。

### AT51｜B08｜model_review｜FR17

- Given：同模型同题同总预算的强基线
- When：运行盲化人工教学比较
- Then：报告诊断/过提示/unknown/成本，不能声称统计因果或只比答案准确率
- 证据：artifacts/acceptance/AT51.json；初始not_run。

### AT52｜B08｜model_review｜FR17

- Given：角色固定输入集与行为脚本
- When：逐角色和全链路回归
- Then：各角色有正反用例、独立结果；模拟与真实模型标签分开
- 证据：artifacts/acceptance/AT52.json；初始not_run。

### AT53｜A09｜manual｜FR17

- Given：有授权受试者或没有受试者
- When：做2-4人观察或不做
- Then：记录是否真人/授权与样本边界；未做为not_run，不伪造学会
- 证据：artifacts/acceptance/AT53.json；初始not_run。

### AT54｜A10｜manual｜FR18

- Given：干净部署环境和真实题库/模型
- When：npm ci/build/start并重启
- Then：完整Web可演示、磁盘可恢复、密钥不入客户端；缺外部条件不宣布全验收
- 证据：artifacts/acceptance/AT54.json；初始not_run。

### AT55｜B10｜manual｜FR18

- Given：现场随机题和四条分支
- When：演示手写修订、同错异教、撤架、故障
- Then：使用实时服务或明确标注回放；答辩展示真实依据和边界
- 证据：artifacts/acceptance/AT55.json；初始not_run。

### AT56｜A09｜e2e｜FR18

- Given：窄屏与键盘用户
- When：完成选题到独立检验报告
- Then：所有核心功能可达；错误态不丢输入，加载状态真实
- 证据：artifacts/acceptance/AT56.json；初始not_run。

### AT57｜B09｜model_review｜FR17

- Given：未参加调参的保留题/脚本
- When：应用最后提示版本
- Then：无针对demo硬编码；保留失败记录并重跑关键P0
- 证据：artifacts/acceptance/AT57.json；初始not_run。

### AT58｜A01｜manual｜FR01

- Given：复用候选列表
- When：依赖安装与许可/安全/烟测准入
- Then：reuse-lock有精确版本和证据；没跑不标accepted
- 证据：artifacts/acceptance/AT58.json；初始not_run。

### AT59｜A05｜unit｜FR11

- Given：AssessmentAgent生成passed=true或使用旧画像
- When：校验评分请求/结果
- Then：禁止额外字段和旧画像；独立性只由代码计算
- 证据：artifacts/acceptance/AT59.json；初始not_run。

### AT60｜B05｜integration｜FR07

- Given：新增补偿节点与撤架完成
- When：导出当前route图
- Then：数学依赖无环，source及canonical目标保留；教学重试另存
- 证据：artifacts/acceptance/AT60.json；初始not_run。

## 附录D｜应用内函数与角色契约

这些是一个Next.js应用内部调用边界，不需要再建OpenAPI服务/SDK。

| 函数 | 归属/文件 | 输入→输出 | 约束 |
| --- | --- | --- | --- |
| importBank | A / `src/features/bank/actions.ts` | teacher + staged JSONL and local upload assets → import audit + bank_version | teacher mutation; no silent drops |
| selectAndStart | A / `src/features/bank/actions.ts` | SelectInput → StudentView | owner mutation; records selected ID and preparation session before models |
| retryPreparation | A / `src/features/bank/actions.ts` | MutationInput → StudentView | same selected ID; CAS then preparation workflow |
| submitTurn | B / `src/features/tutor/actions.ts` | TurnInput → StudentView | owner mutation; confirmed evidence; runner + atomic checked commit |
| handleCheck | A / `src/features/assessment/actions.ts` | CheckInput → StudentView | owner mutation; state-specific start/plan/final/help/reassess |
| correctSubmission | B / `src/features/tutor/corrections.ts` | CorrectionInput → StudentView | revision + dependency invalidation; never retract exposure |
| confirmTranscript | A / `src/features/media/actions.ts` | ConfirmTranscriptInput → TranscriptDraft | owner mutation; all uncertain lines explicitly confirmed |
| transcribeMedia | A / `src/app/api/media/route.ts` | owner + multipart file/request_id → TranscriptDraft | validated private upload and vision only, no diagnosis |
| readOwnedMedia | A / `src/app/api/media/[id]/route.ts` | owner + media_id → binary image | GET ownership, DB mapping only, no URL/path input |
| loadSession | A / `src/shared/queries.ts` | owner + session_id → StudentView | GET safe allowlist, no mutation |
| loadReport | A / `src/features/report/queries.ts` | owner + session_id → Report | GET computed independence; no model call |
| listHistory | A / `src/features/history/queries.ts` | owner + opaque cursor → safe session summaries | GET own sessions only |
| openTeacherTrace | B / `src/features/teacher/actions.ts` | teacher authorization + TeacherInput → TraceStep[] + safe RunRecord projection | POST explicit exposure committed first; no future rubric |
| deleteSession | A / `src/shared/delete.ts` | MutationInput → void | owner mutation revoke runs then cascade; must not resurrect |
| getRunStatus | A / `src/shared/queries.ts` | owner + session_id → StudentView.run_status + version | GET no unguarded token streaming |
| saveAssessmentDraft | A / `src/features/assessment/actions.ts` | CheckInput action=save_draft → StudentView | no model/no feedback; plan editing forbidden after lock |

## 附录E｜交付物和配套文件

本PRD配套附件qisi-sdd-v3.zip。它包含requirements/tasks/traceability、48类严格Schema、状态/角色/16内部函数、SQL/Port、16正例/20负例/16行为脚本、角色测试、启动提示和静态校验。实现时每次改Schema同步fixture与AT。

设计：[多Agent设计V6.1](https://docs.popo.netease.com/lingxi/a3ceafa9c4ac4a1ebab7ebd04068a9c2)；规划：[双人约十天规划V3.1](https://docs.popo.netease.com/lingxi/98264ae3b38941a5aaf1b62e59abc31c)。

本规格交付不包含真实key/正式题库/应用实现/真实学生测试数据。不要把静态校验报告用于声称已达到比赛效果。

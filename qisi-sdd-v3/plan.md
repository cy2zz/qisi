# 启思｜双人约十天开发规划 V3.1

> 交付基线：qisi-3.1；规格核验日期：2026-09-16。设计V6.1、开发规划V3.1与PRD V3.1配套使用，完整机器契约、测试夹具、A/B启动提示和校验脚本见仓库当前qisi-sdd-v3.zip；POPO仍是历史qisi-3.0附件，本次未同步。本交付是开发规格，不是已实现的应用或学习效果证明。

版本qisi-3.1，2026-09-15。20人日基准，约10开发日；两位开发者A/B，单个全栈Web，不做前后端分离。不是固定十天强行砍功能的承诺；按P0验收调日历。D9/D10安排质量修复与发布缓冲，不另计双倍人日。

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

## 1. 分工和关键路径

A交付平台基础、题库、手写、独立检验/AssessmentAgent、报告/历史、部署；B交付多Agent编排、备课/诊断/策略、教学页、输出守卫、教师依据和教学质量。组件、Server Action、DB、测试属于同一张纵向任务卡。

关键路径：D1契约/持久层→D2题库+备课→D3真实教学+手写→D4诊断/独立检验→D5动态干预/评分→D6修订/教师依据/重测→D7恢复安全→D8实测→D9修复→D10发布。

D1首两小时A/B冻结StorePort、ModelPort、StudentView、错误结构和目录归属，随后并行实现。每天至少一次同一Web真实接线，不能各自写Mock页面直到最后一天才联调。

### D1–D2技术栈落地次序（不是额外增加两天）

- D1首2小时：A/B按ADR-001冻结根目录、StorePort/ActiveRunContext、ModelPort、checkpoint数据表与锁顺序；A保持唯一依赖和迁移owner。
- D1剩余：A完成Next/MySQL基础及迁移；B完成StateGraph、AI SDK适配口与MySQL saver最小协议。可以先用FixtureProvider联调，但MySQL必须真实。
- D2开始前优先完成ST01–ST07可执行部分和一次Node重启续跑；缺真实模型key时ST05明确blocked_external，不影响数据库/图测试继续。
- saver真实验证若超出D1预计，D2先解该阻塞，题库/备课可做不依赖部分。不得为按十天结束而把saver临时换内存或削掉教学功能。
- D7做故障窗口、删除竞态、TTL/备份/ST08–ST12，不是D7才第一次接MySQL。

## 2. 每日可运行里程碑

| 日 | A的纵向交付 | B的纵向交付 | 当晚共同验收 |
| --- | --- | --- | --- |
| D1 | Next.js骨架、MySQL 8.4、归属、公式渲染 | 契约、LangGraph四Agent壳、AI SDK ModelPort、MySQL saver | 自拟输入经图节点写MySQL→刷新/重启恢复；真实provider能力探测或明确外部阻塞 |
| D2 | 全量题库导入/异常与指定随机 | 备课+核对+AND/OR图与任务池 | 随机到待核对题不换题；冷准备保持题号；包版本可追 |
| D3 | 手写识别/确认/输入 | 真模型教学轮、Guard、学习页 | 文本真实链路可跑；手写确认后同页教学，不提前显示未核对输出 |
| D4 | 独立检验计划锁定/求助状态 | 竞争假设、探针、反证 | 同错不同因有证据；独立检验中途不反馈 |
| D5 | 独立评分Agent、证据报告 | 七干预、学生路线、跳阶/撤架 | 原题完成→新题计划/执行分判；合法异解不误判 |
| D6 | 真正新题重测、历史、删除 | 修订、教师依据/暴露 | 帮助不被修订/刷新/重命名洗白；教师只能看当前依据 |
| D7 | 存储并发/归属/部署故障 | 工作流恢复/预算/Guard攻击测试 | 杀进程恢复、迟到不提交、删会话不复活、无私有泄露 |
| D8 | 全题库审计、分层抽题/E2E | 角色回归、强基线比较 | 有实际题号/输出/分母/成本的报告；失败样本不隐去 |
| D9 | 体验缺陷、交叉复验/演示 | 教学质量修复、保留题复验 | 核心问题修复并再跑，不针对演示题硬编码 |
| D10 | 干净部署、发布清单/回滚 | 提示冻结、答辩和随机现场联测 | P0通过才发布，真实模型/题库未到则诚实列未验收 |

## 3. 资源前置与止损

D1尽早取得题库样本、模型凭据和部署环境。缺一项不把工程停死：可用明确标注的自拟fixture/Mock开发独立部分，但对应真题/真实模型验收保持blocked_external。模型凭据只在.env.local，永不入仓。

复用组件准入由A01主责、B01配合：安装兼容版本、锁文件、README/许可证、漏洞检查和烟测。任何“已复用”的判断要有运行证据；见reuse.md。默认LangGraph.js Graph API编排四Agent，AI SDK Core负责模型I/O；MySQL 8.4薄checkpoint适配由B负责、迁移由A负责。D1/D2恢复门禁不过必须标阻塞，不静默改回内存/SQLite或原生通用引擎。详见adr/ADR-001-stack.md。

风险优先级：误诊/过提示/独立性误标优先于视觉装饰；手写歧义先确认；prepared覆盖不足先补核对流程而不是缩池；多Agent慢先缓存/精简上下文/模型路由而不是删诊断。

## 4. 双人并行不冲突规则

A管理package/config/src/shared/db/公共渲染，B管理contracts/workflows/ModelPort；AssessmentAgent子目录始终A。任务write_scope是最大范围，遇别人已拥有子目录必须排除。公共改动写handoffs先告知负责人，由负责人合入。不要建立两个独立前后端项目“各自开发”。

D8后交叉复验可读对方代码并提交缺陷，但不能未经交接跨写集大改。公共类型变更必须同步schema、fixture、测试和PRD变更记录。

## 5. 工作完成定义

每张卡完成=功能在同一Web能走通+状态落盘+对应AT通过/人工证据齐全+边界与故障已覆盖+交接记录可复现。仅写了文件、只有Mock、只有页面截图、只有schema通过、模型自评“正确”均不等于完成。

每日交接文件handoffs/[TaskID].md记录changed_files、commands_and_actual_results、acceptance_status、known_failures、next_dependency。tasks status从planned→in_progress→review→done，外部阻塞记blocked_external及可继续子项。当前所有任务planned、AT specified/not_run。

## 6. 发布闸门

自动测试与人工/model_review关键项有证据；正式题库完整清单；真实模型实际调用；无严重数学错误、答案泄露或独立性洗白；部署重启/持久化/删除可验证。真人观察可不做但必须如实not_run，不作长期学习效果宣称。预算或日期不允许绕过闸门。

详细任务卡以下列出；完整验收与契约以配套PRD及qisi-sdd-v3.zip为准。
<!-- GENERATED_APPENDIX -->

## 7. A/B执行任务卡与依赖

### A01｜D1｜全栈脚手架、持久层和公共渲染

前置：无，D1契约先约定。
- 读取ADR-001，在qisi-dashboard仓库根建立Next.js 16/React 19/TypeScript/Node 24 LTS应用；保留frontend/backend，不删除历史骨架
- 安装并精确锁定全部选定依赖，初始化Tailwind CSS/shadcn/ui；提交package-lock、Node版本和依赖准入证据
- 建立MySQL 8.4 Compose、健康检查、独立持久卷及迁移脚本；mysql2连接池设置UTC/utf8mb4/READ COMMITTED，检查默认认证与生产TLS
- 实现匿名owner、MySQL StorePort、请求幂等/版本/CAS与短事务；由A统一合入B提出的checkpoint表迁移
- 实现MathMarkdown、安全DTO与Web骨架；用FixtureProvider跑页面→图→校验→MySQL→刷新链路，并协同B验证杀进程续跑
验收：AT01, AT08, AT58, ST01, ST02, ST03, ST04；交接handoffs/A01.md。完整写集和命令见PRD同名卡。

### B01｜D1｜领域契约、四Agent壳和工作流内核

前置：无，D1契约先约定。
- 与A先冻结共享契约及MySQL迁移接口；业务Schema映射严格Zod，跨字段PolicyGate由代码执行
- 实现Preparation/Diagnosis/Strategy/Assessment四Agent独立入口及Renderer/Guard；Assessment业务实现仍归A
- 用LangGraph.js StateGraph定义有界节点/分支，应用统一预算器；关闭SDK隐式重试和图自动节点重试，不启用第二套Agent循环
- ModelPort封装AI SDK Core与具体provider adapter，实现FixtureProvider及真实文本/结构化/图片/取消/usage能力探测；依赖由A锁定
- 按workflow-persistence.md实现MySqlCheckpointSaver薄适配；run_id作thread_id，checkpoint不替代node_runs审计或最终业务事务
- 与A联测MySQL checkpoint读写、pending writes、刷新/杀进程恢复；独立commit前再次校验lease/版本/期限，不能只用MemorySaver验收
验收：AT13, ST05, ST06, ST07；交接handoffs/B01.md。完整写集和命令见PRD同名卡。

### A02｜D2｜全量导入、选题和准备状态Web

前置：A01, B01。
- 读取主办方实际样本，建立JSONL+私有题图导入适配器和异常清单
- 实现题库页指定/随机选择，持久化全范围哈希及抽中ID
- 接入prepare工作流，冷启动显示原题准备与可重试状态
- 证明needs_review/invalid不被静默剔除，刷新不重抽
验收：AT02, AT03, AT04；交接handoffs/A02.md。完整写集和命令见PRD同名卡。

### B02｜D2｜备课Agent、核对、图与检验任务池

前置：B01, A01。
- 实现prepare和route_review双模式；主路线与可选异解的AND/OR图
- 按problem_hash+prompt/model/config版本缓存并记录数学核对来源
- 生成至少两项检验候选，未核对项不得启动检验
- 实现包核对Guard、循环/引用/条件/缺图负例，不以双模型一致当证明
验收：AT05, AT06, AT07；交接handoffs/B02.md。完整写集和命令见PRD同名卡。

### A03｜D3｜手写上传、确认和输入组件

前置：A01, B01。
- 校验文件大小类型真实解码并存私有映射
- 实现VisionPort忠实逐行转写与不确定标记
- 建立草稿编辑、确认、重新上传和Markdown预览组件
- 提交confirmed revision给教学，不把OCR纠错当学生数学能力
验收：AT09, AT10, AT11；交接handoffs/A03.md。完整写集和命令见PRD同名卡。

### B03｜D3｜真实教学轮与可见页面

前置：B01, B02, A02。
- 实现attempt/hint/explain/worked_solution/finish_problem动作
- 诊断策略表达守卫按独立入口串接，Guard通过才事务提交显示
- 学习页先自主输入，只显示当前必要目标，接A输入组件
- 完成一条真模型文本链路与失败中性回退，明确记录真实provider版本
验收：AT14, AT15, AT27；交接handoffs/B03.md。完整写集和命令见PRD同名卡。

### A04｜D4｜独立检验状态与计划锁定页面

前置：A02, B02, A03。
- 构建owner级已见/等价登记与首次attempt表
- start锁定任务，submit_plan锁计划并开放答案区，finish后评分
- 实现不提示的草稿保存和help先持久assistance_requested
- 新任务与求助学习保留任务ID，刷新不能重置首次资格
验收：AT30, AT31, AT32；交接handoffs/A04.md。完整写集和命令见PRD同名卡。

### B04｜D4｜证据诊断和有区分力的探针

前置：B03, A03。
- 实现valid/invalid/unknown与原因独立判定
- 引用当前有效confirmed evidence，预先持久分支与反证
- 按规范goal_key限制两探针，禁止换节点名重置
- 实现同错不同因、已会不教、反证修订与输入歧义回归
验收：AT19, AT20, AT21, AT22, AT23；交接handoffs/B04.md。完整写集和命令见PRD同名卡。

### A05｜D5｜独立评分接线与证据报告

前置：A04, B03。
- 实现独立AssessmentAgent上下文，只拿锁定计划/最终产物与rubric
- 评分加Guard复核，冲突/失败unknown，规划执行分判
- 代码推导独立性与原题完成，不让模型自设passed
- 报告显示帮助请求但未发出、未测、已作废等边界
验收：AT33, AT36, AT37, AT59；交接handoffs/A05.md。完整写集和命令见PRD同名卡。

### B05｜D5｜七类策略、动态台阶与路线归属

前置：B04, B02, A04。
- 实现七类intervention和L0-L4，显式详解优先
- 实现student/teacher/coauthored路线与route_review核对后补丁
- 自主有效产物可跳阶，连续两次有效尝试降低支架候选
- PolicyGate校验披露/保留、预算、引用，拒绝被提示伪装独立
验收：AT16, AT17, AT18, AT24, AT25, AT26, AT60；交接handoffs/B05.md。完整写集和命令见PRD同名卡。

### A06｜D6｜真正新任务重测、历史与隐私删除

前置：A05, B05。
- 重测选择经过核对且owner未见的新任务，等价/近重复单列
- 实现历史会话、报告链接和实际曝光归属
- 实现24h图片/7d文本清理与主动删除级联撤销run
- 记录未做延迟测验而非补一个虚假长期掌握值
验收：AT34, AT35, AT38, AT47；交接handoffs/A06.md。完整写集和命令见PRD同名卡。

### B06｜D6｜输入修订与教师决策依据

前置：B04, B05, A05。
- 修订保留旧/新输入与依赖失效，不抹实际帮助
- 教师独立cookie/限流/授权，打开当前trace先计whole_task曝光
- 展示证据/候选/探针/动作/后续观察与真实节点记录，不展示隐藏CoT
- 学生历史只读安全摘要，教师页不预取未来解法
验收：AT12, AT29, AT39, AT40, AT41；交接handoffs/B06.md。完整写集和命令见PRD同名卡。

### A07｜D7｜存储故障、归属和部署纵向加固

前置：A06, B06。
- 并发、相同request不同payload、旧版本和跨owner测试
- 提交后断网复用结果，删除中回调不可复活
- MySQL 8.4与私有媒体卷备份/恢复；单Node实例+数据库服务部署，故障期间拒绝成功响应，不自动降级内存数据库
- 安全扫描RSC/HTML/网络、私有图访问与Origin
验收：AT42, AT44, AT46, AT48, ST08, ST09, ST10, ST11；交接handoffs/A07.md。完整写集和命令见PRD同名卡。

### B07｜D7｜工作流恢复、预算和守卫攻击回归

前置：B06, A06。
- LangGraph/MySQL checkpoint结合node_runs/input/model/prompt哈希恢复；覆盖checkpoint写前后、领域commit前后杀进程，验证只一次有效提交
- 所有模型尝试计全局call/token/time预算，最多一次schema修复和文本重写
- 执行提示注入、私有答案泄露、假证据与越权角色负例
- 确认中性fallback不生成虚构曝光，正常消息也先检查后显示
验收：AT28, AT43, AT45, AT49, ST06, ST07, ST08, ST09, ST12；交接handoffs/B07.md。完整写集和命令见PRD同名卡。

### A08｜D8｜全题库审计与端到端验证

前置：A07, B07。
- 全量统计题目/缺图/准备/核对状态分母，确认抽题范围
- 按主题分层随机抽取不少于12题或小题库全量，保留失败样本
- 对每题执行真实会话与独立检验或记录未就绪原因
- 输出UI/延迟/成本/输入故障报告，不用只跑自拟题代替题库验收
验收：AT02, AT04, AT30, AT50；交接handoffs/A08.md。完整写集和命令见PRD同名卡。

### B08｜D8｜角色回归与强基线教学比较

前置：B07, A07。
- 冻结同错不同因等行为脚本、角色输出oracle与提示版本
- 同模型同题同预算比较强苏格拉底基线和完整系统，可追加合并角色消融
- 盲化人工核对数学/诊断/过提示/unknown，报告分母与不可比轨迹
- 真实模型输出与FixtureProvider报告分开，不把模拟学生当真人学习证据
验收：AT19, AT20, AT24, AT51, AT52；交接handoffs/B08.md。完整写集和命令见PRD同名卡。

### A09｜D9｜体验修复、验收人复查与演示路径

前置：A08, B08。
- 修复A范围P0缺陷，覆盖窄屏/键盘/空态/超时/错误恢复
- 交叉复验B的教师与教学输出，不跨写集直接改B代码
- 有授权时做2-4位学生/老师观察并单列样本限制，无授权not_run
- 准备随机选题、手写修订、同错不同教、撤架重测现场演示
验收：AT36, AT38, AT53, AT56；交接handoffs/A09.md。完整写集和命令见PRD同名卡。

### B09｜D9｜教学质量修复和全场景回归

前置：B08, A08。
- 按失败类别修复提示/图/策略，禁止针对演示题硬编码答案
- 用未参与调参的保留题/脚本复验，保留旧失败证据
- 交叉复核A独立性和报告逻辑，有误交A修复
- 所有角色与全链路测试重跑，确认新增提示未退化保留决策
验收：AT05, AT16, AT19, AT24, AT28, AT57；交接handoffs/B09.md。完整写集和命令见PRD同名卡。

### A10｜D10｜发布冻结、部署验收和交付缓冲

前置：A09, B09。
- 从干净环境npm ci/build/启动；迁移MySQL 8.4、健康检查，恢复数据库与媒体备份并验证删除操作
- 逐项汇总P0测试、题库覆盖和依赖准入证据
- 检查密钥/手写数据不入仓库与录像，整理运行和回滚说明
- 仅全部发布闸门通过才标可演示，否则列明未完成和追加日程
验收：AT01, AT46, AT48, AT54, AT58, ST01, ST10, ST11；交接handoffs/A10.md。完整写集和命令见PRD同名卡。

### B10｜D10｜提示冻结、现场联测与答辩材料

前置：B09, A09。
- 冻结model/prompt/packet版本和预算配置，提供复现命令
- 交叉现场抽题演示依据、故障恢复与学习证据
- 整理已证明/未证明能力与开源来源，不用Agent数量替代证据
- 与A共同签署验收清单，保留未来优化而不隐瞒核心未完成
验收：AT13, AT40, AT41, AT55, ST05, ST12；交接handoffs/B10.md。完整写集和命令见PRD同名卡。

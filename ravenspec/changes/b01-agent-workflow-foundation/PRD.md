# B01 领域契约、四 Agent 壳和工作流内核 产品需求文档

> 创建日期: 2026-09-16
> 变更: `b01-agent-workflow-foundation` ｜ 角色: B ｜ 开发分支: `develop-B-v1.0`
> 产品基线: `qisi-3.0` ｜ 本文状态: 需求草案，尚未实现或验收

## 需求概述

在现有 `qisi-dashboard` 应用中建立严格领域契约、四角色独立调用边界和受预算及持久化契约约束的工作流基础，使后续教学、评分功能能通过同一组接口接入，而不是用一次模型调用伪造多个 Agent 或允许模型直接改写学生状态。

### 背景、用户与需求来源

- 产品目标是诊断数学思维卡点、分步干预并验证撤去帮助后的独立表现，不是直接展示答案。B01 为此提供工程基础，不交付完整教学体验或学习效果结论。
- 本期直接使用者是开发者 B、接入共享基础设施及 AssessmentAgent 的开发者 A，以及验证角色隔离与失败路径的测试人员；学生和教师是后续业务接入后的使用者。
- 任务来源是 `qisi-sdd-v3/tasks.json` 的 **B01**，前置依赖为空，关联 **FR01、FR06、FR15**，直接验收项为 **AT13**。无前置依赖意味着契约和可控测试可先做，不意味着 A 的基础设施已经实现。
- 本变更没有 `EARS.md`。需求依据本地 README、B 启动指令、任务卡、契约与验收条目，以及当前应用源码；知识库检索未取得可采纳正文，不把“无正文”解释为不存在相关团队规范。

### 当前应用与基线差异

源码检查显示：`frontend/src/main.jsx` 是介绍页并请求 `/api/health`；后端 `QuestionController`、`QuestionService`、`QuestionMapper` 提供按 ID 查询题目，`Question` 只有 `id/source/concept/stem`。当前未发现 ModelPort、StorePort、FixtureProvider 或四角色工作流实现；后端现有测试为 Spring 上下文加载测试。以上是静态检查，不代表已运行应用。

历史基线使用原生 TypeScript、Zod、SQLite 及 `qisi-web/src/**` 路径。当前根目录约定优先：继续使用本仓库的 React/Vite 前端和 Java 17 / Spring Boot 3.5.5 / MyBatis / H2 后端，不另建 `D:/math/qisi-web`，不迁回 Next.js，不引入独立 Python 服务。历史契约的字段、边界和行为保留；等价验证机制、编排和存储适配须在 DESIGN/ADR 中明确映射，不能声称直接照搬原方案。

### 本期范围与非目标

**纳入 B01：**

1. 48 个领域 Schema 的严格契约映射及相关跨字段校验，公共 Agent/ModelPort/StorePort 边界。
2. Preparation、Diagnosis、Strategy、Assessment 四角色的独立入口契约、上下文、提示引用和回归入口；B 的角色壳及 Renderer/Guard 接口。
3. 可记录调用并注入失败的 FixtureProvider，以及至少一个按实际配置接入的真实 provider 适配及能力探测入口。
4. `prepare/turn/grade` 确定性骨架、预算器、节点复用与 checked commit 协议，可用受控 StorePort 测试实现验证内核。
5. 后续设计中的当前栈适配 ADR、失败先行测试、A/B 契约交接与真实执行证据要求。

**不纳入本次：**

- 不替 A 实现 AssessmentAgent 评分业务、身份/Origin 基础设施、数据库迁移、全局配置或依赖变更。Assessment 公共契约和测试替身不等于 A 的正式实现；若需在 A 专属目录建立空壳，也须经 A 确认。
- 不提前实现 B02 完整数学准备与异解评审、B03 真实教学轮与页面、B04 证据诊断、B05 七类策略与动态台阶、B07 完整恢复与故障体验，或其他后续任务。
- 不开发题库导入、OCR/确认页面、独立检验页面、报告、教师视图、历史/删除页面；不改现有首页或题目查询行为。
- 不把内存测试存储称为 SQL 持久化或跨进程恢复完成，不把 FixtureProvider 称为真实模型，不把 Schema 合法称为数学正确或人工复核通过。
- 不重写 `qisi-sdd-v3/`、旧任务状态、manifest、ZIP 或发布凭证。本轮仅生成 PRD，业务代码、DESIGN、specs、TASK 和验收结果另按工作流推进。

## 核心功能

### F1：严格领域契约与语义边界

**描述**：以 `contracts/domain.schema.json` 的 48 个 `$defs` 为来源，在当前后端栈定义可验证的输入、私有中间结果和安全输出契约。每个已声明对象都拒绝未知字段；校验包含必填项、枚举、类型、长度/数量限制和引用关系，不能仅用宽松反序列化或通用 Map 代替。

- 建立 Schema 名称到应用契约及测试的映射；不把现有 `Question` 直接冒充完整 `Problem`。
- 对节点/路线引用、路线内先修关系无环、路线终点归属、证据绑定的 submission/revision、披露与保留决策集合等适用约束进行代码校验。
- 输入、模型输出、持久化候选与公开投影分别经过所需校验。模型不能提供 owner、独立通过权限或任意状态补丁。
- SessionState、Packet、Diagnosis、Strategy 等私有对象不能直接成为 API 返回；StudentView/Report 等公开对象按白名单构造。B01 提供边界和测试，不代替后续页面接入。

**边界条件**：
- 正常情况：结构及适用语义均合法的数据进入下一节点；记录使用的契约版本。
- 异常情况：额外字段、失效 revision、悬空引用、成环路线、越权字段被拒绝，错误不能带出私有正文。结构通过但数学证据不足时保留 `unknown/needs_review` 等基线状态，不能升级为正确或人工认证。

### F2：四角色独立入口与 Renderer/Guard 接口

**描述**：每个角色具有独立的输入输出校验、上下文投影、角色提示和可单独执行的回归入口。允许共用 provider 及低层工具，但不能共用一个全量上下文或用单次通用回答拆成四份假日志。

| 入口 | 输入 → 输出 | 可用上下文与权限边界 | B01 归属 |
| --- | --- | --- | --- |
| Preparation | PreparationInput → Packet / RoutePatch，按模式选择 | 给定题干/图与授权参考；不接触 owner，不直接展示或写会话 | B 的独立入口与壳；完整数学准备属 B02 |
| Diagnosis | DiagnosisInput → Diagnosis | 仅已确认的有效证据；不读取未确认转写或未来检验内容 | B 的独立入口与壳；B03 接线，完整证据诊断属 B04 |
| Strategy | StrategyInput → Strategy | 按契约投影诊断和当前任务；不改变预算、不授予独立资格 | B 的独立入口与壳；B03 接线，完整策略/台阶属 B05 |
| Assessment | AssessmentInput → AssessmentOutput | 锁定计划、最终答案与对应任务；不得包含历史诊断/画像，不评定独立资格 | B 定义公共适配口及测试替身；A 实现评分业务 |
| Renderer | RendererInput → RenderedMessage | 最小获准事实和问题；不接收完整参考答案、未来 rubric 或原始诊断 | B 提供接口与最小接线；完整文本质量属后续任务 |
| Guard | GuardInput → GuardResult | 检查候选产物并给出受限结果；不能自行展示或写会话 | B 提供接口与最小接线；不能代替代码 PolicyGate |

**边界条件**：
- 正常情况：`prepare/turn/grade` 分别经过对应角色入口；同一 provider 仍保留每次独立调用的 role、model、prompt 版本和输入标识。
- 异常情况：角色输出错误 Schema、越界上下文、Assessment 接口缺失、Guard 拒绝时不得返回未检查内容。测试中可显式注入 Assessment 替身；非测试运行不得静默降级为替身。

### F3：ModelPort、FixtureProvider 与真实模型准入

**描述**：以 `contracts/ports.ts` 的 ModelPort 语义屏蔽供应商协议差异。请求包含 role、model、system、input、可选图像、outputSchema、输出 token 上限和取消信号；响应包含待校验产物、可用的 provider request ID、usage 及其可信类型、时延、provider/model。凭据只在服务端使用。

- FixtureProvider 使用有标识的自拟夹具，按角色/场景返回可控数据，支持非法 JSON/Schema、超时、取消、unknown usage 和可记录的调用顺序；缺少匹配 fixture 应失败，不返回通用成功结果。
- 真实模式通过 `MODEL_BASE_URL`、`MODEL_API_STYLE`、`MODEL_API_KEY`、`MODEL_TEXT_ID`、`MODEL_VISION_ID` 配置。具体供应商、协议及模型 ID `[待补充：以项目提供的有效配置为准]`，不得预设一个模型名称充数。
- B01 实施交付需包含至少一个与实际配置相符的 provider 适配和可单独调用的探测入口，验证文本、结构化或可校验 JSON、视觉输入、usage、超时/取消。视觉探测只检查能力，不开发 A 的 OCR 业务。
- 无原生 JSON Schema 能力时可服务端严格校验，并在剩余预算内最多修复一次；不支持必需能力时给出明确结果，不宣称能力具备。
- 探测记录应区分成功、失败、未运行及外部阻塞，保留版本/时延/usage 元信息，不保存密钥或隐藏思维链。应用取消不等于远端一定停止计费。

**边界条件**：
- 正常情况：同一组角色契约可在显式 fixture 模式和已配置真实模式运行，不改变业务 Schema。
- 异常情况：缺凭据、供应商不支持能力或调用失败时，真实探测标记 `blocked_external` 或实际失败；不得静默切换 FixtureProvider。可继续与外部配置无关的契约及内核测试。

### F4：确定性流程、预算与受控提交

**描述**：编排器而非模型决定节点顺序、权限、预算与提交。B01 建立可执行骨架及可替换业务节点，为后续完整策略和持久化接入保留明确接口。

- `prepare`：Preparation → Guard/代码校验 → 受控保存准备结果；失败不替换所选题，也不伪造 ready。
- `turn`：已确认输入 → Diagnosis → 必要时一次 route review → Strategy → 代码 PolicyGate → Renderer → Guard → 原子 checked commit。
- `grade`：隔离的 Assessment 入口 → Guard/代码校验 → checked commit。规划/执行判断与独立资格分离，独立性由代码依据真实曝光和锁定记录计算，不由模型授予；完整规则接入仍归 A/后续任务。
- PolicyGate 的调用顺序及“未批准就不能写/展示”的硬边界在 B01 必须成立；各阶段完整教学规则不因本骨架验收而视为完成。

StorePort 暴露 `reserve/getReusableNode/saveNode/commitChecked/revoke` 的语义：可信服务端上下文提供 owner；request ID、payload hash、expected/reserved version、lease 和 deadline 约束每个 run。模型调用在数据库事务之外执行，私有节点结果不等于已经对外展示。

- 相同 request ID + 相同 payload 的成功请求返回原安全响应，不重复调用或曝光；不同 payload 返回 `REQUEST_CONFLICT`。
- 版本冲突、会话忙、失效 lease、删除或截止时间到期都不能产生最终提交。失败 request 的同 ID 重试复现原结果；主动重试用新 ID，但保留原题和已冻结输入。
- 节点只在输入、模型、提示和配置哈希匹配且 lease 有效时复用；远端结果未知的重试计入预算，不能承诺外部调用恰好一次。
- 最终提交需重新检查身份归属、资源存在、版本、lease、deadline，并将事件、状态/版本、checked 消息、实际曝光和请求安全响应作为同一原子结果。未通过检查或未提交的正文不得流式输出。
- 测试 StorePort 用于验证上述调用顺序和禁止提交路径；真实 SQL 约束、迁移与重启恢复由 A 基础设施及 B07 后续联调提供证据。

**边界条件**：
- 正常情况：测试可观察到确定的节点顺序、预算扣减和一次有效提交，重放返回相同安全响应。
- 异常情况：修复、重写、route review、失败尝试、网络重试全部计入同一个 run；触及调用/token/时间上限即停止，不泄露部分模型输出，不撤销已真实发生的曝光。

## 用户场景

### 场景 1：B 运行四角色基础回归

**入口**：后端测试入口，后续 TASK 明确 AT13 的实际可执行命令，不新增面向学生的调试页面。

**触发条件**：FixtureProvider、StorePort 测试实现以及含 Assessment 替身的独立角色注册已就绪。

**操作流程**：
1. 测试人员分别启动 prepare、turn、grade，提供各自合法输入和 prompt 版本。
2. 检查调用记录中的真实入口、Schema、上下文投影与节点顺序，而不是只断言最终文案。
3. 注入一个角色非法输出，确认该节点被拒绝且不能伪造其他角色成功或提交状态。
4. 输出 fixture 标识、实际用例数、结果和安全调用摘要；不生成真实模型或产品验收声明。

### 场景 2：A 接入 Assessment 和持久层

**入口**：B01 公共契约与交接材料，A 的适配实现不在本变更写集内。

**触发条件**：双方已确认当前 Java 栈的接口、错误、版本及 StorePort 语义。

**操作流程**：
1. A 用正式 Assessment 实现替换测试替身，不修改其他角色契约。
2. A 提供可信身份上下文和 StorePort 适配；B 用相同契约测试检验接线。
3. 核验旧诊断不进入 Assessment、模型不授予独立资格、Guard 通过前没有公开提交。
4. A 适配尚未提供时标为待联调；不得用替身测试通过替代正式集成结果。

### 场景 3：B 探测真实 provider

**入口**：服务端显式能力探测入口；命令形式在 DESIGN/TASK 确定，不向浏览器暴露密钥。

**触发条件**：项目已提供有效模型配置，执行者明确选择真实模式。

**操作流程**：
1. 校验配置并标记真实 provider/model，不默认猜测供应商。
2. 执行文本、JSON、视觉及 usage/取消能力检查，记录实际结果。
3. 缺配置则报告具体缺失的配置项并保持真实验收外部阻塞；fixture 回归仍可独立执行。

### 场景 4：重复请求、超时和撤销

**入口**：工作流/StorePort 的故障注入测试，非新增 UI。

**触发条件**：存在运行中或已完成的 run，可控制时间、lease、版本及节点响应。

**操作流程**：
1. 重放已成功请求，验证只返回原安全响应；更换同 ID 的 payload 则冲突。
2. 在模型返回前撤销 lease 或推进时间越过 deadline。
3. 收到迟到响应后断言 checked commit 被拒绝、会话不被重建且无新曝光。
4. 仅将此结果报告为受控内核测试；真实删除、断网恢复、跨进程重启另行集成验收。

## 边界条件

| 场景 | 处理方式 |
| --- | --- |
| 未确认手写转写或过期 submission revision | 不进入 Diagnosis；不自动确认，交给 A 的确认/修订流程 |
| 学生采用不同于参考的路线 | 不因路线不一致直接判错；保留 route review 适配口和 unknown，数学质量属后续验收 |
| 模型返回额外字段或身份/权限字段 | 严格拒绝，不能用丢弃未知字段的方式伪装校验成功 |
| Guard 未 accept / PolicyGate 未批准 | 无公开输出及最终状态提交；有限重写仍受总预算约束 |
| 准备失败或题图缺失 | 保持原题与问题记录；不缩小题池、不自动换题、不标 ready |
| 相同 ID 不同 payload / 旧版本 / 已有 active run | 分别按契约返回 REQUEST_CONFLICT / VERSION_CONFLICT / BUSY，无第二次有效提交 |
| 队列等待或节点调用超时 | 等待也计入总 deadline；停止后续节点并撤销有效提交资格，记录可能产生的远端消耗 |
| usage 为 estimated 或 unknown | 保守估算输入并预留输出上限，标明可信类型；不能按零消耗绕过预算 |
| 节点输入/model/prompt/config 任一变化 | 不复用旧节点结果；新调用照常扣减预算 |
| 删除、owner 失效、lease 撤销后模型返回 | 禁止迟到提交、回写数据或重建会话 |
| 模型称 human_reviewed / independent_pass | 不授予此类结论；须由真实复核记录或受控业务规则确定 |
| 需要新增依赖、共享配置或表结构 | 形成 A 的交接请求，不直接越权修改全局文件或迁移 |

## 非功能需求

### 性能与预算

沿用 `qisi-sdd-v3/runtime.json` 的预算语义；如需降低上限，应记录配置，未经变更确认不得提高。下表是规范上限，不是已测性能。

| 工作流 | 正常调用参考 / 最大调用 | 总 deadline | 输入 token 上限 | 输出 token 上限 | B01 覆盖 |
| --- | --- | --- | --- | --- | --- |
| turn | 4 / 7 | 90 秒 | 24000 | 8000 | 骨架和预算测试 |
| prepare | 2 / 4 | 180 秒 | 32000 | 16000 | 骨架和预算测试 |
| grade | 2 / 3 | 60 秒 | 20000 | 6000 | 隔离适配口、替身和预算测试 |
| transcribe | 1 / 2 | 45 秒 | 12000 | 6000 | 公共预算配置兼容，不实现 A 的转写业务 |

- 模型共享并发上限 **4**；普通节点超时 **25 秒**，prepare 节点 **60 秒**，且不得超过剩余总 deadline。provider/SDK 隐式重试须禁用，所有实际尝试可计数。
- 每 run Schema 修复最多 **1** 次，文本重写最多 **1** 次；每 turn route review 最多 **1** 次。正常调用数是参考，不应为凑数量制造调用。
- 每 canonical goal 最多 **2** 次教学探针是后续业务必须保留的不变量，不能靠换节点名重置；不与“真实 provider 能力探测”混为一谈。
- 暖轮 p50 ≤ **15 秒**、p95 ≤ **35 秒** 是基线待测目标。B01 用可控时钟验证预算行为，真实延迟需在模型/环境可用后测量，不预填达标。

### 兼容性、安全与可观测性

- 兼容当前 Java 17 后端和 React/Vite 前端；复用现有工程启动方式，不为多 Agent 概念增加平台依赖。当前栈与历史 FR01 的工程组织差异需记录，但不借此重建应用。
- 生产身份、Origin 和归属校验接入由 A 提供；B 的端口只接受可信上下文，不接受模型或客户端提供 owner。未知及他人资源不得通过错误细节泄露存在性。
- 节点记录须能关联 request/run、role、输入哈希、model/prompt/config 版本、尝试次数、usage 类型、时延及状态。普通日志脱敏，私有产物仅通过受控存储访问，不记录凭据、隐藏思维链或整段学生正文到通用日志。
- 公开消息仅在 checked commit 后返回；不展示完整教师路线、未来检查题答案或未经批准的事实。
- 仅对单实例语义提供本期保证，不宣称支持多实例恢复。持久化一致性、数据保留与删除的生产证据须在 A 的基础设施/后续集成中补齐。

## 验收标准与追溯

下列均为待执行标准，不是通过结果；B01 直接基线验收是 AT13，其余本地 AC 用于限定基础能力，不替代后续 AT。

| 标识 | 对应功能 | 操作 → 可验证结果 | 证据边界 |
| --- | --- | --- | --- |
| AC01 | F1 | 加载 48 个契约映射，执行合法与未知字段/引用/revision/成环等反例 → 适用约束逐项通过或拒绝，不接受宽松解析 | 映射清单及实际非零测试；仅契约/语义检查 |
| AC02 / AT13 | F2、F4 | Given 四角色入口与 FixtureProvider；When 分别运行 prepare/turn/grade；Then 调用记录和入口断言证明经过各自契约/提示节点，不是一次调用伪造四阶段 | AT13 的 unit 证据明确 Assessment 为替身，不宣称 A 评分业务完成 |
| AC03 | F2 | 尝试把未确认证据、历史诊断、完整参考答案注入不允许的角色 → 上下文投影/校验拒绝；单角色非法输出不能被其他角色“补成成功” | 独立角色正反例；不等于教学质量评测 |
| AC04 | F3 | 同一合法角色请求在 fixture 模式与真实探测入口执行 → 模式、provider/model、usage 类型可辨；fixture 无匹配和真实缺配置均显式失败 | Fixture 结果可本地验证；真实结果按实际成功/失败/blocked_external 记录 |
| AC05 | F3 | 配置真实 provider 后探测文本、JSON、视觉、usage、取消/超时 → 每项有真实响应或失败说明；修复不超过一次 | 无凭据时不得判此项通过，亦不阻塞独立契约草案 |
| AC06 | F4 | 注入延迟、失败重试、修复/重写及队列等待 → 调用、时间、token、并发上限均不能绕过；不会发起超预算节点 | 可控时钟/provider 的内核测试，非真实性能报告 |
| AC07 | F4 | 重放同 ID 同 payload、冲突 payload、旧版本及可复用节点 → 安全重放/拒绝/复用行为符合协议，最终提交最多一次 | 测试 StorePort 证据；真实 SQL/CAS 另验 |
| AC08 | F1、F4 | Guard 拒绝、lease 撤销、deadline 过期或删除后返回模型结果 → 无公开正文/新曝光/最终提交/会话重建 | 受控失败路径；不代替完整删除和恢复 E2E |

| 基线来源 | 本次承接 | 不在 B01 宣布完成的部分 |
| --- | --- | --- |
| FR01：全栈 Web 和可重现启动 | 遵循当前仓库工程、公共接口可接入、保留旧应用能力 | A01/A10 的整体启动部署及 AT01/AT58 |
| FR06：受控多 Agent | 独立契约/上下文/提示/回归及 AT13 | 完整诊断策略、教学业务、AT14 和后续真实模型质量 |
| FR15：运行恢复和预算 | 预算、幂等、版本、节点日志与撤销的基础协议及可控测试 | A01/A07/B07 的真实持久化恢复及 AT42–AT45；AT46 删除联动亦需后续集成 |
| B01 任务卡 | 本变更唯一领取的任务；设计阶段继续分解测试与交接 | 不把 B02–B10 合并进本次，也不修改旧任务卡状态 |

实施阶段实际验证入口以现有工程为准：后端在 `backend/` 执行 `mvn test`，前端在 `frontend/` 安装依赖后执行 `npm run build`；AT13 具体测试选择方式在 TASK 中列明。当前前端只有 dev/build/preview 脚本，不将历史 `npm run typecheck`、`test:task`、`test:e2e:task` 当作已有命令。测试不能以零用例成功替代验收；Raven 工具测试也不能替代产品测试。

本 PRD 创建阶段不执行或预填产品 AT，不创建伪造的 `artifacts/acceptance/AT13.json`。后续实施证据应放在当前应用工作区而非改写已发布规格包，包含实际命令/退出码、用例数、fixture/真实模式、版本及失败/外部阻塞说明。

## 影响模块、协作依赖与待确认项

| 模块或文件范围 | 影响与归属 |
| --- | --- |
| `backend/src/main/java/com/qisi/ai/` 下新增契约、角色、工作流模块及对应测试/提示资源 | B 的预期实施范围；具体包名由 DESIGN 固化。Assessment 业务实现排除 |
| 现有 QuestionController / QuestionService / QuestionMapper / Question | 本期保持行为；后续 A 题库模型与完整 Problem 对接，不由 B 擅改 |
| `frontend/src/main.jsx`、`styles.css` | B01 无页面修改；后续 tutor/teacher 功能仍由 B 负责，公共页面基础归 A |
| `backend/pom.xml`、全局配置、`application.yml`、`schema.sql`/`data.sql`、前端 package/lock | A 负责；新增验证依赖、配置或真实存储需求通过交接请求由 A 合入 |
| `ravenspec/changes/b01-agent-workflow-foundation/` | 本变更工件和当前栈差异记录；不修改旧基线 |
| 编排 ADR 与 B01 交接 | 后续明确契约冻结、文件归属、失败测试、命令、结果和未完成项，不在本轮预写完成报告 |

1. **[待补充：DESIGN + A 确认] 当前栈等价方案**：严格 JSON Schema 验证/跨字段校验如何落地 Java；H2 的事务、唯一约束和节点日志如何承接 StorePort；不默认引入 Zod 或 SQLite。
2. **[待补充：A/B 契约冻结] 适配及注册归属**：Assessment 公共接口、可信 owner 上下文、StorePort 实现责任、错误映射及版本语义；A 专属目录的任何壳由 A 确认，未联调前保持显式替身标识。
3. **[待补充：项目方] 真实模型准入**：可用 API style、文本/视觉模型、凭据及调用环境；缺失时相应实施/验收项为 `blocked_external`，不能宣布整张 B01 done。
4. **[待补充：DESIGN/TASK] 可执行测试与证据**：当前栈 AT13 测试入口、契约映射清单和 ADR/交接位置，以及 A 的共享基础设施接入时间。只能在实际执行后记录通过。

以上未知项不妨碍先建立需求草案，但在选择依赖、修改共享文件或进行真实联调前必须解决；如改变基线产品行为，需显式确认，不用“适配”名义删除能力。

## 回滚计划

- **本轮文档回滚**：仅针对本变更新增的 PRD 工件撤回或修订；保留已有 `.ravenspec.yaml`、原有未提交文件及其他人的修改，不使用全仓 reset/clean。
- **后续实现回滚**：B01 新模块应可从装配入口移除，不改变当前首页、健康检查或题目查询协议。按经确认的文件清单撤回 B 的变更，避免撤销 A 的适配和并行工作。
- **存储与配置**：B 不直接实施数据库迁移；若 A 为接入增加配置/表结构，由 A 提供兼容和迁移回退方案。停止新工作流时撤销有效 lease，保留已提交曝光及历史记录，不清库或重建用户会话。
- **基线保护**：回滚不触及 `qisi-sdd-v3/`、manifest、ZIP 和发布凭证；不自动提交、推送或运行发布脚本。

## Capabilities

`ravenspec/specs/` 当前只有 `.gitkeep`，无可修改的已归档能力。以下是当前应用新增能力，通过引用衔接 qisi-3.0，而非迁移旧规格。

### 新增能力

- `strict-domain-contracts`: 领域 Schema 的当前栈映射、跨字段/引用校验、私有对象和公开投影边界（F1）。
- `isolated-agent-interfaces`: 四角色独立契约、上下文、提示及 Renderer/Guard 接口，含 A 的 Assessment 适配边界（F2）。
- `model-provider-boundary`: ModelPort、显式 FixtureProvider、真实 provider 适配与能力探测、usage/取消语义（F3）。
- `controlled-workflow-kernel`: prepare/turn/grade 骨架、预算、PolicyGate/Guard 顺序、StorePort 幂等/版本/撤销与 checked commit 协议（F4）。

### 修改能力

_无_

## 本地基线引用

以下路径相对仓库根目录，均作为只读来源，不以本文覆盖原文件：

- `README.md`、`AGENTS.md`、`ravenspec/config.yaml`：当前工程、B 角色入口及 Raven 工件/授权规则。
- `qisi-sdd-v3/README.md`、`AGENTS.md`、`prd.md`、`plan.md`、`prompts/developer-b.md`：产品目标、B01 起点、当前栈需显式适配的历史约定。
- `qisi-sdd-v3/tasks.json`（B01）、`requirements.json`（FR01/FR06/FR15）、`acceptance/cases.json`（AT13）：任务、需求、验收追溯。
- `qisi-sdd-v3/contracts/README.md`、`domain.schema.json`、`agents.json`、`ports.ts`、`state-transitions.json`：领域数据、角色权限、状态与提交协议。
- `qisi-sdd-v3/runtime.json`、`prompts/{preparation,diagnosis,strategy,assessment,renderer,guard}.md`：调用预算及角色提示基线。
- `frontend/src/main.jsx`、`frontend/package.json`、`backend/pom.xml`、后端 controller/service/domain 及现有测试：当前应用能力与实际命令依据。

# AGENTS.md｜qisi-dashboard 仓库级开发规范

适用范围：本 Git 仓库及其所有子目录；开发者 A、开发者 B、单个开发 AI 和经授权的开发子 Agent 均须遵守。规则日期：2026-09-16；对应产品规格基线：**qisi-3.1**。

本文件是统一执行入口，不是新的 PRD，也不代表应用已经实现。只收到评估、文档或排障请求时，只执行该请求，不自动开始产品开发。

## 1. 每次开始都先核对工作区

1. 读取本文件，执行 `git rev-parse --show-toplevel`、`git status --short --branch`，确认真正的仓库根、分支、已暂存和未提交改动；不要依赖目录名、会话记忆或固定盘符。
2. 修改文件前读取路径上适用的子目录 `AGENTS.md`。父级规则继承，子目录规则补充本地细节；规则、任务和契约冲突时明确报告并先解决，不自行择取较宽松的一版。
3. 核对 `qisi-sdd-v3/stack.json` 的 `baseline`、`qisi-sdd-v3/runtime.json` 的 `version`、`qisi-sdd-v3/manifest.json` 的 `baseline` 及 PRD：产品基线仍为 qisi-3.1，活动规格采用 React/Vite `web/` + NestJS `server/` + MySQL 8.4。`publication/`、manifest、历史 ZIP 和已被替代的变更记录可以保留旧发布内容，但只能作为历史凭证，不能覆盖活动规格。缺文件、仍为 qisi-3.0、旧 Raven 配置或旧任务引用均须报告。技术路径、命令和验收未实际验证时，不得声称相应任务完成；不阻塞独立的文档或迁移工具维护。
4. 分支名不是角色或任务完成的证据。从用户授权、任务卡和交接记录确定当前 owner、Task ID、前置状态、允许写集与验收。用户未指定 A/B 但明确授权完整开发时，按单 AI 模式串行领取就绪任务，不默认同时开多个开发 Agent。
5. 简述本轮目标、角色/任务、写集、检查命令和已知阻塞再执行。后续仍在同一授权范围、依赖已就绪时可连续推进；每张卡保留独立验证/交接检查点，不机械地每卡等用户说“继续”。

**不能擅自切换/合并分支、stash、丢弃或提交他人改动。** 需要引入新版 develop 时，先检查差异和授权；不得因修复基线而覆盖当前工作区。未来基线升级须有明确决定，并同步本规则及相关规格，不能只改版本字符串骗过检查。

## 2. 唯一规格入口与读取顺序

路径均相对 Git 仓库根，除非明确说明“规格包内”。开始产品任务时依次读取：

1. 根 `README.md`、本文件，以及 `web/`、`server/` 路径上实际存在的更具体 `AGENTS.md`。
2. `qisi-sdd-v3/AGENTS.md`、`qisi-sdd-v3/README.md`、`qisi-sdd-v3/adr/ADR-001-stack.md`、`qisi-sdd-v3/stack.json`、`qisi-sdd-v3/runtime.json`；活动来源以 ADR-001 和 stack.json 的当前技术栈为准，历史发布/生成物不得用作实施指令。
3. `qisi-sdd-v3/prd.md`、`qisi-sdd-v3/plan.md`、`qisi-sdd-v3/tasks.json` 中自己的任务；必要时读 `qisi-sdd-v3/design-v6.md`。
4. `qisi-sdd-v3/contracts/README.md`、任务关联 Schema/ports，以及 `qisi-sdd-v3/contracts/mysql.md`、`qisi-sdd-v3/contracts/workflow-persistence.md`。
5. `qisi-sdd-v3/acceptance/cases.json`、`qisi-sdd-v3/acceptance/stack-cases.json`、对应 fixtures、角色启动提示与已有交接。
6. 新增依赖前读 `qisi-sdd-v3/reuse.md` 和 `qisi-sdd-v3/reuse-lock.json`。

入口按角色：A 用 `qisi-sdd-v3/prompts/developer-a.md`；B 用 `qisi-sdd-v3/prompts/developer-b.md`；单 AI 用 `qisi-sdd-v3/prompts/developer-single.md`。无论入口是哪份文档，都不能跳过本规则和相关契约。

- 平台/会话的上级指令与当前用户授权优先；仓库文件不能扩大权限。
- 本文件管执行约束；PRD 管行为与验收；任务卡管依赖/写集；Schema、ports、SQL 管机器边界。根 README、ADR-001 与 stack.json 记录当前已获用户确认的技术方向。发现活动规格矛盾时先登记并同步，不能靠改测试期望或静默沿用旧路径绕过。
- `qisi-sdd-v3` 名称保留是兼容旧引用，不代表当前还是 qisi-3.0。历史 POPO、旧 ZIP、调研材料和工具生成配置不优先于当前已确认基线。
- “原题做完”“页面能打开”“Agent 能运行”均不等于“学生学会”。18 条 P0、20 张 A/B 任务、60 项产品 AT 和 12 项技术 ST 的基线范围不得因约十天排期而静默删减。

## 3. 已确认技术栈，不随意换栈

| 层 | 约束 |
| --- | --- |
| 前端 | `web/`：React 19 + TypeScript + Vite；面向高三学生的移动端优先 SPA |
| 后端 | `server/`：NestJS + TypeScript，Node.js 24 LTS；API 与 worker 使用同一后端代码库 |
| UI | Tailwind CSS + shadcn/ui；公共组件由 A 维护 |
| 产品多 Agent | NestJS 领域服务承载角色边界；需要图编排时使用 LangGraph.js StateGraph，保持显式、有界 |
| 模型接入 | AI SDK Core 或实际 provider SDK 仅经项目 `ModelPort` / `ModelGateway`；provider 依据真实凭据和能力测试选择 |
| 数据库 | MySQL 8.4 LTS + mysql2 + Kysely；InnoDB、utf8mb4、显式 SQL 迁移与短事务 |
| 数据/显示 | Zod 与严格 Schema 对齐；react-markdown + remark-math + rehype-katex / KaTeX |
| 图片 | server 侧 sharp 校验、解码 + 多模态转写 + 学生确认 |
| 验证 | Vitest + NestJS/Supertest + Playwright + 真实 MySQL 8.4 集成测试；区分 fixture、真实模型、人工教学评估 |
| 部署 | Docker：React 静态站点 + NestJS API/worker + MySQL + 私有媒体存储；同域反向代理 `/api` |

- 前端只写入 `web/`，后端、worker、迁移和服务端测试只写入 `server/`。旧 `frontend/`、`backend/` 的删除以及 `web/`、`server/` 的现有内容属于当前未提交迁移，未经授权不得回退、覆盖或据此宣称初始化完成。
- 使用 mysql2/sharp 的代码只能位于 `server/` 并运行在 Node runtime；密钥、私有题解、数据库连接和教师私有依据不得进入 `web/` bundle、静态文件或浏览器响应。
- 精确依赖版本、Node patch、镜像 digest 和 provider adapter 要实际安装、兼容性验证后锁定，不使用 `latest`、不编造锁文件、不把 `reuse-lock.json` 当 npm 安装锁。`web/` 与 `server/` 各自的 package/lock 由 A 统一维护；引入根 workspace 需有明确变更记录。
- 禁止自动降级 SQLite、H2 或内存数据库冒充目标持久化；禁止另写通用图引擎、自由群聊 Agent 平台，或叠加第二套自动 Agent 循环。工作流恢复优先依赖 MySQL 领域状态、幂等步骤、任务租约和审计事件；不得因为缺少官方 LangGraph.js MySQL saver 就静默采用未经验证的社区实现。

## 4. A/B 责任边界：按功能纵向交付

**A/B 不是前端/后端分工。** 每张业务卡都包含相应页面、服务端、持久化、安全边界和测试。

| 责任方 | 主责与独占边界 |
| --- | --- |
| A | 根配置/容器/CI，`web/` 公共 UI 与依赖，`server/` 数据库门面和全部迁移；题库、媒体、输入、独立检验、报告、历史/删除；AssessmentAgent |
| B | `server/` 中 contracts/model/workflows/prompts、Preparation/Diagnosis/Strategy Agent、Renderer/Guard；`web/` 中教学页和教师依据；工作流步骤与恢复接线 |

`qisi-sdd-v3/tasks.json` 的活动写集使用 `web/` 和 `server/`；执行前仍须核对具体任务的允许/排除范围及现有工作区。跨 owner 的共享接口先在交接/变更中提出，由对应 owner 合入；不能以“顺手修一下”改对方文件。

- B 的 `server/src/agents/**` **排除 `server/src/agents/assessment/**` 的业务实现**；D1 必需的空接口壳须与 A 确认。Assessment 归 A，不因 B 编排图而转移归属。
- B 定义工作流恢复需求，A 负责所有 MySQL 表迁移与数据库事务门面；B 不维护第二套迁移/连接池，A 不另写一套 ModelPort。
- A01/B01 先对齐 `StorePort`、`ModelPort`、安全 `StudentView` 和数据库接口。共同基础门禁允许协调联调，但不得把任一方尚未完成的接口写成“已实现”。
- 单 AI 串行仍保留 A/B 归属、前置与交接，不能因此删四个产品 Agent。独立子 Agent 只在用户明确授权并行/委派时启用；产品“多 Agent”不是开发子 Agent 的授权。
- 经授权并行时使用独立 worktree 或严格不重叠写集，明确任务/路径/交接；告知每个开发 Agent 有其他协作者，禁止回退他人改动。

## 5. 每张任务必须执行的 SDD 闭环

1. **Specify**：读取 FR、AT/ST、任务前置和契约，记录输入输出、状态不变量、允许/排除写集、失败场景、验证命令、回滚方法；不直接跳到写实现。
2. **失败先行**：为新增/修复行为写可复现的失败测试，实际运行并记录；明确失败源于预期行为而不是依赖缺失。模型/人工验收先定义输入和 oracle；纯规则/文档变更用引用、版本和一致性检查，不伪造产品测试。
3. **最小纵向实现**：页面 → 服务端 → 受控模型/工作流 → 校验 → 持久化 → 刷新/恢复；不以静态页面、固定答案或虚假接口代替完整功能。
4. **真实验证**：执行本卡 `test_commands` 与相关回归；发现失败修实现，不删除测试、降低阈值、扩大容错或把未执行改成通过。依赖缺失记阻塞，继续独立且已授权的工作。
5. **复核和交接**：保存文件清单、真实命令/退出码、AT/ST 结果、证据、迁移/风险和下一前置。另一位按要求复核；单 AI 明确记录 `self_review`，不冒充独立审查者。
6. **状态更新**：代码完成但未复核用 `implemented_waiting_review`；外部题库/key/服务缺失用 `blocked_external`；只有要求的验证和复核完成才标 `done`。依赖未 done 时只做不依赖它的部分，不能谎称完整交付。

记录位置遵循已有任务/工作流：

- 规格包中的 `changes/[TaskID].md`、`handoffs/[TaskID].md` 指 `qisi-sdd-v3/changes/`、`qisi-sdd-v3/handoffs/` 下的任务记录。
- Raven 变更在 `ravenspec/changes/<change>/`，归档规格在 `ravenspec/specs/`。同一任务已有记录时续写/关联，不另起重复任务；Raven 工件与任务交接相互引用，不维护两套互相矛盾的状态。
- 应用验收证据在仓库根 `artifacts/acceptance/`，按模板及对应 AT/ST 的证据要求记录。测试输入、状态快照、模型/提示版本应可追溯，但不要保存密钥或未脱敏学生内容。
- `qisi-sdd-v3/tasks.json` 是共享规格文件，只更新获授权的任务状态/必要字段；跨 owner 字段由对应负责人合入，避免整文件重写互相覆盖。规格内容变化时按变更协议协调同步契约、测试、版本和包，不静默造成已发布凭证失真。

## 6. 教学产品红线

1. **随机题池完整**：按题库实际内容选题，不硬编码演示题，不缩池、不在失败时暗换简单题；准备失败、覆盖率和限制需可见。
2. **确认后诊断**：支持 Markdown/LaTeX 与手写图片；转写保留不确定性，只有学生确认的当前 revision 才能成为诊断证据。不把 OCR 错误判断成学生概念错误。
3. **台阶服务诊断，不预先代做**：围绕学生卡点选择下一步探针/启发；支持跳阶、异解和按表现调整，不先展示完整答案路线。关键决策和步骤尽量由学生完成。
4. **诊断有证据**：区分“不知道”“表述不清”“计算失误”“概念误解”；异解不得仅因不同于参考路线判错。`unknown` 不算正确，也不能无证据标记学会。
5. **探针有边界**：遵循 `qisi-sdd-v3/runtime.json` 对同一 canonical goal 的两探针上限和稳定目标规则；不得靠换 ID、重试或重启规避预算。
6. **帮助不可撤销**：区分请求帮助与实际发出帮助；实际曝光按契约记账，不因刷新、重答或撤回消息消除。独立任务首次计划/首次作答冻结，提交前不偷偷反馈答案正误。
7. **以独立学习证据验收**：撤去帮助后用新任务检验，区分独立/带帮助、迁移/原题重做；原题完成率、作业得分、模型自评不替代学生真正学会的证据。
8. **可解释但不泄露**：教师页呈现学生证据、诊断假设、置信/不确定性、干预选择与效果摘要；不展示模型隐藏思维链（CoT）、私有系统提示或未检查的输出。
9. **功能不静默缩水**：多 Agent、手写、动态路线、撤架检验、历史/删除、故障恢复均须按 PRD 保留。时间不够如实调整排期，不通过删除 P0 伪称完成。
10. **高三场景优先**：移动端单栏、拍照与公式快捷输入、短时高价值反馈、高考评分点和未成年人数据最小化优先。学生可选择最小提示或直接讲解，不以强制多轮反问增加备考负担。

## 7. 多 Agent、状态与故障恢复边界

- 产品保持 Preparation / Diagnosis / Strategy / Assessment 四个独立角色的上下文、Schema、提示版本和回归；Renderer/Guard 依职责工作。不能只在同一自由聊天提示里写四个名字冒充独立 Agent。
- NestJS 领域服务负责用例和最终状态转换；若使用 LangGraph，只负责显式、有界的流程编排。AI SDK 或 provider SDK 只做模型 I/O。模型输出只是候选数据，不得执行任意 SQL、直接改学生状态或绕过 PolicyGate。
- 所有模型尝试（含修复/重写/失败）计入统一 call/token/time 预算；按 `qisi-sdd-v3/runtime.json` 禁用 SDK 隐式重试和图隐式节点重试。不借无限循环或“自动修复”绕过预算。
- 最终业务提交只经 `StorePort.commitChecked` 或等价 NestJS 领域服务的事务检查。任何 checkpoint 都只是执行快照，不等于业务提交、已展示帮助或学生学会；节点审计也不能替代领域状态。
- 恢复的第一事实来源是 MySQL 中的 workflow run/step、任务租约、模型调用和领域事件。worker 领取任务时重新获得有效 lease/fencing，预算从持久审计恢复；不能信任旧快照中的身份/权限，也不能回滚已经消耗的预算。
- 没有经过许可、维护状态、目标版本、pending writes、取消、删除和崩溃窗口测试，不采用社区 MySQL checkpoint saver。若实现 `BaseCheckpointSaver` 薄适配，也不得形成第二套业务真相。
- 身份/owner、Origin、版本/CAS、幂等、期限和取消/删除必须在最终提交前复查。过期、取消、删除后的迟到响应/checkpoint 不得复活会话或覆盖新状态。
- A01/B01 做真实 MySQL 任务领取、节点落盘、重启续跑和只一次有效提交；A07/B07 做完整竞态/故障矩阵。不得只跑 MemorySaver、SQLite 或 mock 就声称通过 ST。
- 默认不向客户端流式发送未校验模型内容；可以展示安全的运行状态。所有对外消息和 DTO 必须按契约过滤后输出。

## 8. 验证命令和证据标准

先读 `web/package.json`、`server/package.json`、可选的根 workspace 配置和任务卡，确认命令真实存在。A01 负责建立脚本；不存在应实现或如实报缺失，不能用空脚本、零测试或忽略退出码冒充验收。

产品任务按迁移后的真实脚本执行，通常应分别覆盖 `web/` 的 typecheck/lint/unit/build、`server/` 的 typecheck/lint/unit/integration/build，以及根级 Playwright、真实 MySQL 和任务门禁。旧任务卡中的根 `npm run ...` 命令在完成映射前只能作为验收意图，不能虚构为已执行。**不要求纯文档修改启动整套应用，也不允许代码修改只跑文档检查。**

规格检查（从仓库根运行）：

```text
python qisi-sdd-v3/scripts/validate_spec.py
python qisi-sdd-v3/scripts/validate_stack.py
python -m unittest discover -s qisi-sdd-v3/scripts -p test_validate_mysql.py
```

- `validate_spec.py` 会改写规格报告，`package.py` 会重建 manifest/ZIP。只读核验可在独立临时副本执行；未经本轮授权不重打包、覆盖历史报告或运行发布脚本。
- 真实 MySQL 冒烟须先读 `qisi-sdd-v3/contracts/mysql.md` 和脚本保护条件，显式设置 `QISI_MYSQL_SPEC_TEST=1` 并使用获授权的空 `qisi_spec_*` 测试库；禁止连接生产库或用户现有业务库做迁移/清空测试。
- `FixtureProvider`、mock、真模型、人工数学核对、真实学生学习评估分别标识；fixture 不是高考真题或真实学生数据。静态校验通过不证明 SQL 执行、应用联调、模型质量或教学效果。
- 每条结果记命令、工作目录、退出码、实际测试数量、passed/failed/not_run、证据路径及局限；不能把历史成功记录拿来证明当前改动。
- 不把密钥、完整用户会话、私有手写图片放进日志/截图/测试证据；必要数据脱敏，并遵循 PRD 中的保留、删除与权限要求。

## 9. 开源复用与代码质量

- 优先检查本仓库已有实现，再复用适配当前栈的成熟开源；以维护情况、许可、版本兼容、关键行为测试、安全风险和集成成本评估，不以 star 数或 Demo 截图代替质量判断。
- 未核实的依赖标候选/待验证；没有许可或运行证据不写“已通过准入”。不直接搬整套教学 Demo 冒充本产品。
- 保持领域契约、模型端口、编排、持久化、展示分层；复杂度围绕本任务，不为未来需求预建平台。
- 不用广泛 `any`、关闭 strict/lint、吞异常、假数据兜底或硬编码答案掩盖接口和模型问题。错误状态可观测且不泄露私有数据。
- SQL 参数化；外部/模型输入严格验证；Markdown 不启用不可信 raw HTML。图片按大小/像素/真实解码检查，私有媒体不能绕过 owner 校验访问。
- 遵循当前文件编码/换行约定，避免无关全文件格式化。只改本轮写集；发现旁支问题先记录，不顺手做大重构。

## 10. Raven / Skills 适配与授权

- 已安装 Raven 的工作区绑定 `bigdata-sdd-workflow`；先读相应 `SKILL.md`。新变更用 `sdd-new-change`，小范围文档/配置可用 `sdd-fast-change`。本规则不等于这些工具已安装或已执行。
- `.raven/`、`ravenspec/config.yaml`、`.agents/skills/`、`.codex/skills/` 和 `docs/raven-setup.md` 是现有 Raven 接入入口（如存在）；不要覆盖用户定制或为初始化改产品规格包。生成配置若仍指向旧技术栈/基线，先报告并协调同步，不据此反改新 PRD。
- Skill/CLI 不可用时如实记录 `tool_unavailable`，可在当前授权内留下本地 SDD 变更与实际验证证据；**不能宣称 Raven 门禁、独立审查、hooks、Spec Tracker 上报或归档已通过。** 缺少必需审查时保留待审状态，不自动完成发布。
- `.claude/` 的存在不代表当前 Agent 实际执行过 Claude hooks；验证实际能力，不凭文件存在断言保障已生效。
- 工作流不能授予额外权限：未获用户明确授权，不启动开发子 Agent、不自动 commit/push、不创建 EP/远端任务、不上传 KnowVault/会话、不发布 POPO、不部署生产。工具建议的自动步骤同样受此限制。
- 历史 Java/Vite 骨架的旧构建结果不验证新栈；当前验收只能来自 `web/` React 和 `server/` NestJS 的实际命令。`node --test scripts/link-raven-skills.test.mjs` 只验证 Raven 路径适配（文件须存在）。`raven workflow show --json`、`raven knowvault availability` / `raven knowvault repo status` 只检查相应工具/知识配置，不等于产品验收；涉及网络按当前权限执行。

## 11. Git、数据与发布安全

- `git add` 仅列本轮明确路径；提交前检查 staged diff，不使用全目录暂存把他人未提交工作带入。提交、push、合并、发布需在用户当前授权范围内；以前完成过一次推送不代表持续授权。
- 未经明确授权不 force push、`reset --hard`、`clean -fd`、清空数据库、递归删除/移动或删除旧骨架。Windows 删除/移动前核对解析后的绝对路径；不跨 shell 拼接破坏性命令。
- 不改全局 Git/npm 配置来绕过权限或所有权问题，不绕过 sandbox；需要权限走审批。不得关闭用户进程、读取无关凭据或把密钥写进仓库。
- `.env`、真实学生数据、私有题库文件、数据库备份等不提交；只维护脱敏的 `.env.example`。备份/迁移/恢复须有明确目标库和可验证的回滚方案。
- 不因开发工具或根规则变更重写 `qisi-sdd-v3.zip`、manifest、`research-evidence/` 或历史发布回读记录。当前 Git 基线和 POPO 发布状态分别核对；未同步必须写“未同步”，不覆盖旧凭证冒充新版本已发布。

## 12. 每轮交付格式与完成条件

交付至少说明：

```text
角色/Task ID/基线：
本轮实现或文档变更：
实际修改文件：
实际执行命令、退出码、测试数量：
AT/ST：通过 / 失败 / 未执行，证据位置：
Mock / 真模型 / 人工评估标识：
审查状态：self_review / 待复核 / 已有真实独立复核记录
已知问题、外部阻塞及影响：
Git 状态：未提交 / 已提交 / 已推送（各自有实际证据）
下一张就绪任务或明确恢复条件：
```

“文件写好”“实现完成”“验收通过”“已推送”“已部署”“学生学会”是不同结论，只报告有证据支持的那一级。不因为对话结束或排期用完就把所有任务标 done。

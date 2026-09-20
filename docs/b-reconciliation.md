# B 侧重复实现对齐材料

日期：2026-09-20 ｜ 涉及分支：`develop`（A）与 `develop-B-v1.0`（B，本地，未合并）

## 0. 为什么需要这份材料

`develop` 上已有 A 实现的 **B02 / B03 / B04**（见 `qisi-sdd-v3/handoffs/{B02,B03,B04}.md`，均为 A 撰写），与 `develop-B-v1.0` 上的 B 侧实现**大面积重叠**。

直接合并会产生 11 个冲突文件，其中 5 个是「两边建了同一批表」。盲合并的两种结果都不可接受：要么毁掉 A 的全部工作，要么留下两套并行实现。

**因此本轮决定：先不合并，先对齐。** 本文列出重叠面、各自优劣与建议收敛方向。

## 1. 规模对比

| | 文件数 |
| --- | --- |
| `develop` 独有 | 281 |
| `develop-B-v1.0` 独有 | 21 |
| 两边都有但内容不同 | 364 |

`develop` 已包含：`features/{assessment,bank,history,learning,media,preparation,report,speech}`、**18 张建表 SQL**、`web/src/pages/learn/{check,report}/`、全部 e2e 用例、A01–A09 与 B01–B04 交接。

## 2. `develop-B-v1.0` 独有的 21 个文件（B 侧内核）

```
server/src/agents/preparation/route-graph.ts
server/src/features/tutor/{probe-counter,student-view,tutor.service,tutor.controller,tutor.module}.ts
server/src/workflows/{prepare,turn}.ts
server/src/model/upstream-model-bridge.ts（+ .spec.ts）
server/test/preparation/{packet-lifecycle,route-graph}.spec.ts
server/test/tutor/{at27-renderer-input,probe-and-projection,submit-turn}.spec.ts
web/src/pages/learn/SessionPage.tsx
```

以及 B01 已随 `e4b9054` 合入 develop、但 A 之后又改过的：`workflows/{orchestrator,policy-gate}.ts`、`agents/renderer/index.ts`、相关测试。

## 3. 逐项对比

### 3.1 建表 SQL —— **建议采用 develop 的**

同名 5 个文件（`requests` / `runs` / `node_runs` / `events` / `packets`）两边都建了，但设计不同：

| | B 的版本 | develop 的版本 |
| --- | --- | --- |
| 来源 | 逐字取自规格 `contracts/database.sql` | 重新设计 |
| ID 类型 | `VARCHAR(191)` | `CHAR(36)` UUID |
| 归属外键 | **全部移除** | 保留，指向 `sessions`/`users` |
| 围栏 | 靠 `lease_token` 轮换 | 独立 `fencing_token` 列 |
| 审计列 | 无 | `db_update_time` / `db_create_time` |
| 索引 | 仅主键/唯一键 | 另有 `idx_runs_session_status` 等 |
| 注释 | 无 | 逐列中文 COMMENT |
| 命名风格 | 无引号 | 反引号 + 命名约束 |

**B 移除外键的原因**：`AGENTS.md:53` 要求 `<表名>.sql` 命名，而 Kysely 按字母序执行（`migrator.js:470-472` 的 `Object.keys().sort()`），`node_runs`(n) 先于 `runs`(r) 建表，外键必然失败。

**为什么 develop 的更好**：A 的 `sessions` 用 `BIGINT UNSIGNED` 主键，B 的 `VARCHAR(191) session_id` **与之不兼容**；A 的 18 张表风格统一、外键完整、有索引。B 的版本是规格的忠实转写，但**无法与 A 的表共存**。

→ **结论：B 的 5 个建表文件作废，采用 develop 的。** 但 A 需注意：`AGENTS.md:53` 的命名规范与 Kysely 字母序执行的矛盾**依然存在**，只是 A 的表恰好没触发（A 的表外键指向的表名字母序在前）。

### 3.2 `web/tests/e2e/tutor.spec.ts` —— **两套不同测试，需决定测哪个**

| | B 的版本 | develop 的版本 |
| --- | --- | --- |
| 测的对象 | `SessionPage`（`/learn/:sessionId`） | A 的教学页（`/study`） |
| 打桩的 API | `GET /api/session/:id` + `POST /api/tutor/turn` | `POST /api/problems/{analyze,chat}` + `.../draft` |
| 断言重点 | 信任边界（策略字段不得入 DOM）、未请求帮助不泄露 | 四级帮助、响应式折叠、RichComposer、SSE |

**两者测的是不同的实现**。B 的页面（`SessionPage.tsx`）**当前没有路由**——`App.tsx:101` 的 `/learn/:sessionId` 指向 A 的 `FixtureLearningPage` 占位组件。

→ **需决定**：正式教学页是 B 的 `SessionPage`（四 Agent 链路）还是 A 的教学页（`features/analysis` 链路）？这决定 `tutor.spec.ts` 保留哪份，以及 `App.tsx` 的路由指向。

### 3.3 ModelPort —— **统一已在进行中，但仍有遗留**

`develop` 的 `model.port.ts` **已新增** `outputSchema?: z.ZodType` 与 `images?: readonly ModelImage[]`，即 A 已把自己的接口往 B 的方向靠拢。`server/src/model/` 下仍并存 `ports.ts`（B）与 `model.port.ts`（A）两份定义。

→ **建议**：确认以哪份为唯一接口，删除另一份。B 侧的 `upstream-model-bridge.ts` 是过渡桥接，统一后即可删除。

### 3.4 **B 实测发现的两个真实缺陷 —— develop 上依然存在**

B 已用真实 provider（`gpt-5.5`）实测，发现两处会让**按规格走四角色链路的人**必然失败的问题：

**① `response_format: json_object` 要求 messages 含 "json"，否则 400**

```
400 'messages' must contain the word 'json' in some form,
    to use 'response_format' of type 'json_object'
```

`develop` 的适配器**仍无条件设置**该参数（`openai-compatible-model.port.ts:75`），而**规格包的角色提示 `qisi-sdd-v3/prompts/*.md` 通篇不含 "json"**（实测 4 份提示各 0 处）。

A 的链路能通过，是因为 A 用的是自写提示（`CHAT_SYSTEM_PROMPT` 里含「只返回严格 JSON」），**未使用规格包的角色提示**。规格要求四角色独立契约与提示，一旦接上真实提示词，每次调用都会 400。

**② `outputSchema` 从未告知模型（B01 自身的设计缺口）**

该字段只用于事后校验，从未下发；A 的适配器也不接收。规格包的提示是中文散文、不含任何字段名。实测中模型据此自造字段：

```
实际返回 hypotheses[].gap_type / description / probe.question / expected_evidence
契约要求 hypotheses[].kind / explanation / missing_evidence / probe.goal_key / question_md / branches
```

结构校验必然失败，**且 B01 的「一次修复」重试也救不了**——重试只回注校验错误，模型仍不知道正确字段名。

**B 的处置**：在桥接层用 `z.toJSONSchema(outputSchema)` 把契约注入 system（同时满足 ①）。**建议 develop 采纳同等机制**，否则四角色链路接真实模型时仍会失败。

### 3.5 `AGENTS.md:53` 的命名规范与 Kysely 执行顺序

`AGENTS.md:53` 要求「一张表对应一个 `<表名>.sql`」，而 Kysely 在 `node_modules/kysely/dist/migration/migrator.js:470-472` 做 `Object.keys(allMigrations).sort()`，**按迁移名字母序执行**。凡外键指向字母序靠后的表，建表必然失败。

当前 A 的表恰好未触发，但这是**潜在陷阱**。建议要么改 `SqlMigrationProvider` 做拓扑排序，要么在 `AGENTS.md` 注明该限制。

### 3.6 `database.factory.spec.ts` 在 Windows 上必挂

`src/database/database.factory.spec.ts` 断言 `expect.stringMatching(/certs\/ApsaraDB-CA-Chain\.pem$/)`，只匹配正斜杠；Windows 实际路径为反斜杠。**Linux CI 会过、Windows 开发机必挂**，且会挡住任何走 `npm run test:task` 的门禁。

→ 建议改为跨平台断言（如 `path.join` 或同时接受两种分隔符）。

## 4. 建议的收敛方向

| 层 | 建议 |
| --- | --- |
| 建表 SQL | **采用 develop**（A 的 18 张表），B 的 5 个文件作废 |
| 四角色 Agent 链路 | **保留 B 的**（`agents/*`、`workflows/{turn,prepare}`、`features/tutor`、`policy-gate`）——A 的 B03 交接自述「正式多 Agent 持久化工作流未接线」 |
| 可见教学页 | **需决定**：`/learn/:sessionId` 指向 B 的 `SessionPage` 还是维持 A 的教学页 |
| ModelPort | 确认唯一接口，删除另一份；B 的桥接层随之删除或并入 |
| 真实 provider 契约传达 | **采纳 B 的 `z.toJSONSchema` 注入机制**，否则四角色链路接真实模型必失败 |
| Windows 兼容断言 | 修 `database.factory.spec.ts` |
| 迁移执行顺序 | 修 `SqlMigrationProvider` 支持依赖顺序，或注明限制 |

## 5. B 侧保留意见

- B 的实现**未经真实 MySQL 执行**（项目方要求不跑 `db:migrate:dev`），故建表文件本就应让位于 A 已实跑过的版本。
- B 的 `upstream-model-bridge.ts` 是**过渡设施**，模型端口统一后应删除。
- B 的 B02/B03 交接（`develop-B-v1.0` 上的版本）记录了 A 未覆盖的内容：探针防绕过机制（`canonical_goal_key` + 补偿节点归并）、`StudentView` 白名单投影的字段级约束、`mathCertified` 类型级恒假。建议这些**语义**无论代码归谁都要保留。

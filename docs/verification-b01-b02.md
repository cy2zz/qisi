# B01 / B02 验证指南

对应提交：B01 `e4b9054`、B02（本轮）。基线：`qisi-3.1`。

## 0. 先纠正一个前提

**B01 和 B02 都是纯 `server/` 的卡，两卡都没有碰 `web/`。**

| 卡 | write_scope 涉及前端？ |
| --- | --- |
| B01 | 否 —— 全部是 `server/src/{contracts,agents,workflows,prompts,model}/**` 与 `docs/adr/` |
| B02 | 否 —— 全部是 `server/src/{agents/preparation,workflows/prepare.ts,features/preparation,prompts}/**` |

前端页面是 **A01（公共 UI 骨架）、A02（题库页 `/bank`）、B03（教学页 `/learn`）** 的写集，目前都不存在。所以「前后端都做了」这个说法对这两卡不成立，**完整的端到端验证现在做不了**。

因此下面分三段：现在就能验的、需要人工判断的、现在验不了的。

---

## 1. 现在就能验的（命令 + 预期输出）

全部在仓库根执行。**每条都实际跑过。**

```bash
npm --prefix server run typecheck
npm --prefix server run lint
npm --prefix server run test
npm --prefix server run build
```

| 命令 | 预期 | 说明 |
| --- | --- | --- |
| `typecheck` | 退出 0，无输出 | `tsc --noEmit`，strict 模式 |
| `lint` | 退出 0，无输出 | `eslint src test --max-warnings=0`，`no-explicit-any` 为 error |
| `test` | 退出 0，**238 passed / 14 files** | B01 191 项 + B02 47 项 |
| `build` | 退出 0 | 产物在 `server/dist/` |

### 分文件测试分布

B01：

| 文件 | 项数 | 验证什么 |
| --- | --- | --- |
| `src/contracts/domain.schema.spec.ts` | 41 | 48 个 schema 对规格夹具的映射、16 个合法夹具、6 条结构反例 |
| `src/contracts/semantic.spec.ts` | 26 | 14 条语义反例 + 断言它们在结构上仍合法 |
| `src/model/budget.spec.ts` | 22 | 调用/token/deadline 上限、共享额度、并发不挤过 |
| `src/model/budgeted.provider.spec.ts` | 18 | 统一记账、schema 修复共享一次、usage 估计、并发上限 |
| `src/model/fixture.provider.spec.ts` | 20 | 夹具消费、故障注入、缺夹具显式失败 |
| `src/workflows/runtime.spec.ts` | 5 | 内嵌限额与 `runtime.json` 深度比对 |
| `test/agents/at13-role-isolation.spec.ts` | 9 | **AT13** 四角色独立契约与提示节点 |
| `test/workflows/policy-gate.spec.ts` | 30 | 披露边界、探针上限、模型不得授予独立资格 |
| `test/workflows/store-and-recovery.spec.ts` | 20 | 幂等、版本 CAS、lease/fencing、节点复用 |

B02：

| 文件 | 项数 | 验证什么 |
| --- | --- | --- |
| `test/preparation/route-graph.spec.ts` | 19 | AND/OR 图、环检测、补丁只增不改、`problem_hash` |
| `test/preparation/packet-lifecycle.spec.ts` | 28 | **AT05** 结构缺陷入 needs_review、**AT06** 哈希绑定、检验候选池 |

### 两条值得单独跑的深度检查

**① 契约是否真的对齐规格包**（不是自说自话）：

```bash
# 重新生成 Zod，然后确认无差异——证明 48 个 schema 可从规格包确定性还原
node server/src/contracts/generate-zod.mjs
git diff --exit-code server/src/contracts/domain.schema.ts

# 提示正文三方一致（TS 常量 / 本地 .md / 规格包 .md）
npm --prefix server test -- prompts
```

**② 构建产物是否真的带上提示正文**（这是 B01 踩过的坑）：

```bash
npm --prefix server run build
ls server/dist/prompts/          # 应有 index.js，且【没有】任何 .md
node -e "import('./server/dist/prompts/index.js').then(m => console.log(m.PROMPT_VERSION, m.AGENT_ROLES.length))"
# 预期：prompt-v3.0 6
```

### 验证时需要留意的两件事

- `npm run build` 会改动**已被 Git 跟踪**的 `server/tsconfig.build.tsbuildinfo`（`*.tsbuildinfo` 没进 `.gitignore`）。跑完 `git status` 看到它被改是正常的，别当成代码改动提交。
- 测试直接读 `qisi-sdd-v3/fixtures/` 与 `qisi-sdd-v3/prompts/`。**规格包受 `.gitattributes` 的 `-text` 保护**，测试只读不写；不要为了通过测试而改规格包。

---

## 2. 需要人工判断的（自动脚本不能填）

**AT07 是 `layer: model_review`，现在必须是 `not_run`。**

规格写死了这一点：

> 所有人工/模型用例保持 `not_run`，直到证据 JSON 包含执行人、commit、题库/model/prompt 版本和实际结果。（`contracts/README.md` §10）
> 人工/model_review 不能由自动脚本填 `passed`。（`AGENTS.md` §8）

AT07 的要求是「参考有明显数学错误或无依据 → 备课并复核 → 不自动认证；出现冲突 needs_review 及问题记录」。要验它需要：真实题库 + 真实模型凭据 + 一个能判断数学对错的人。**现在三者都没有。**

同理，以下也不能靠跑脚本宣布通过：

- **数学正确性**。B01/B02 的 `mathCertified` **在设计上恒为 false** —— 代码路径上不可能授予数学认证（见 `server/src/features/preparation/packet-verification.ts`）。这不是功能缺失，是规格要求「结构不充当数学认证」的类型级落地。
- **`FixtureProvider` 的结果不等于教学效果**。夹具是自拟数据，不代表高考真题或真实学生表现。

---

## 3. 现在验不了的（及其阻塞方）

| 验收项 | 为什么验不了 | 阻塞方 |
| --- | --- | --- |
| **AT13 正式证据** | 断言已跑通，但证据文件 `artifacts/acceptance/AT13.json` 未产出 | A01（`artifacts/` 目录） |
| **AT05 / AT06 正式证据** | 同上 | A01（`artifacts/` 目录） |
| **AT06 真实集成** | 组件级已验证；跨进程重启与真实持久化未验 | A01（`server/src/shared/db` 门面）+ B07 |
| **AT07** | 需真实模型 + 人工数学核对 | A（模型依赖与凭据）+ 项目方（题库） |
| **ST05 模型 I/O** | 本机无任何模型 SDK，且加依赖属 A | A（锁定并安装依赖、提供凭据） |
| **ST06 MySQL 恢复** | 本机 MySQL 为 8.0.26，`migrate.ts:26` 硬要求 8.4.x；无 Docker | A01 / 环境 |
| **ST07 真实分支矩阵** | 预算与修复路径已验；真实 provider 分支待接 | A（模型依赖） |
| **端到端页面链路** | `web/` 下尚无题库页与教学页 | A02（`/bank`）、B03（`/learn`） |
| **`test:task` / `test:e2e:task` / `test:stack`** | 三条脚本不存在 | A01 |

---

## 4. 对 A 的依赖（完整清单）

### 4.1 硬阻塞 —— 不做完这些，B 的卡无法标 done

| # | 依赖项 | 影响的卡 | 当前状态 |
| --- | --- | --- | --- |
| 1 | `server/src/shared/db` 门面（pool、短事务回调、任务领取、`lockActiveRun`、服务端 UTC、参数化查询） | B01 步骤 5/6、B02 持久化 | **未交付**。`server/src/shared/` 不存在；`origin/dev_A` 亦无（只有 `65330fc feat: 支持在线数据库`） |
| 2 | `artifacts/acceptance/` 目录 | AT05/AT06/AT13 | 不存在 |
| 3 | `test:task` / `test:e2e:task` / `test:stack` 脚本 | 全部 AT/ST | 不存在。`contracts/README.md` §10 明确由 A01 创建 |
| 4 | MySQL 8.4 环境（或 Docker） | ST06、AT06 真实集成 | 本机 8.0.26，无 Docker |
| 5 | 模型依赖（AI SDK Core）+ provider 凭据 | ST05、AT07 | 未安装；`server/package.json` 属 A 的锁定范围 |
| 6 | `runs`/`node_runs`/`jobs`/`model_calls` 建表迁移 | B01 步骤 5、B02 落库 | 现有迁移只有 `app_metadata` 一张表 |
| 7 | `app.module.ts` 装配 | B01/B02 模块接入应用 | **不在 B 的写集**，需 A 合入 |

### 4.2 A 需要向 B 交付的接口（B 已定义，A 实现）

| 接口 | 位置 | 说明 |
| --- | --- | --- |
| `StorePort` | `server/src/workflows/store.port.ts` | B 定义并与 `contracts/ports.ts` 对齐；A 提供 MySQL 实现 |
| `AssessmentAgentPort` | `server/src/agents/assessment-port.ts` | B 定义适配口与测试替身；A 实现评分业务 |

### 4.3 B 未越界的事项（供 A 核对）

- 未创建 `server/src/agents/assessment/**`（`excluded_write_scope`）。
- 未新增或修改任何迁移与表结构。
- 未修改 `server/package.json`（因此没有 `test:task` 等脚本）。
- 未修改 `server/src/app.module.ts`。
- 未修改 `eslint.config.mjs`、`server/tsconfig*.json` 等公共配置；生成器所需的 eslint 豁免写在 `.mjs` 文件自身的局部 `eslint-disable` 里。

### 4.4 B 已提出的规格偏差（需项目方或 A 确认）

| # | 偏差 | 影响 |
| --- | --- | --- |
| 1 | `contracts/README.md` §12 写迁移在 `server/migrations/**`，实际骨架在 `server/src/database/migrations/` | A 的范围 |
| 2 | B02 写集测试路径为根 `tests/preparation/**`，但根目录无 vitest 配置，测试无法执行 | B 已改放 `server/test/preparation/**` 并记录 |
| 3 | B01 `depends_on: []` 但步骤 5/6 依赖 A01 | 任务卡依赖声明不准 |
| 4 | B02 写集含 `server/src/workflows/prepare.ts`，而 B01 已把 prepare 放在 `orchestrator.ts` | 已抽为独立文件，orchestrator 委托 |
| 5 | `*.tsbuildinfo` 未被 `.gitignore` 覆盖，却被 Git 跟踪 | 每次 build 都会产生脏工作区 |

---

## 5. 最短验证路径（建议顺序）

```bash
# 1. 确认基线
git log --oneline -3                      # 期望看到 B01/B02 两个提交

# 2. 全量自动化验证
npm --prefix server run typecheck && npm --prefix server run lint && npm --prefix server run test

# 3. 确认契约可从规格包确定性还原（防手改生成物）
node server/src/contracts/generate-zod.mjs && git diff --exit-code server/src/contracts/domain.schema.ts

# 4. 确认构建产物带提示正文
npm --prefix server run build && ls server/dist/prompts/

# 5. 读交接记录里【未声明通过】的部分
#    qisi-sdd-v3/handoffs/B01.md 的 acceptance_status
#    qisi-sdd-v3/handoffs/B02.md 的 acceptance_status
```

**第 5 步是关键。** 自动化测试全绿只说明代码自洽，不代表验收项通过 —— AT05/AT06/AT13 缺证据文件，AT07 按规格必须 `not_run`，ST05/ST06 是 `blocked_external`。别让「238 passed」被读成「B01+B02 验收通过」。

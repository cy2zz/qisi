# ADR-001｜工作流编排选型

- 状态：已接受
- 日期：2026-09-17
- 范围：B01（领域契约、四 Agent 壳和工作流内核）
- 关联：`qisi-sdd-v3/adr/ADR-001-stack.md`、`qisi-sdd-v3/runtime.json`、`qisi-sdd-v3/contracts/workflow-persistence.md`、`qisi-sdd-v3/contracts/ports.ts`

## 1. 背景

B01 需要在 `server/` 中建立 prepare / turn / grade / transcribe 四条工作流的执行结构，承载 Preparation、Diagnosis、Strategy、Assessment 四个 Agent 以及 Renderer、Guard 两个受控模块。

规格对编排手段的措辞是**可选**而非强制，三处均留口：

- `AGENTS.md` §3：*「需要图编排时使用 LangGraph.js StateGraph，保持显式、有界」*
- `design-v6.md` §5.1：*「复杂分支可**使用** LangGraph.js Graph API」*
- `runtime.json`：`runner = "nestjs_worker_with_optional_langgraphjs"`

因此本 ADR 需要明确回答：B01 是否引入图执行引擎。

## 2. 事实基础

按 `design-v6.md` §5.1 与 `runtime.json` 的 `workflows`，四条工作流的控制流为：

```text
prepare:    Preparation ──▶ Guard ──▶ PolicyGate ──▶ commit
transcribe: Vision ──▶ 规则校验 ──▶ 草稿提交
turn:       Diagnosis ──▶ [可选 route_review ×1] ──▶ Strategy
                        ──▶ PolicyGate(代码) ──▶ Renderer ──▶ Guard
                        ──▶ [可选 重写 ×1] ──▶ checked commit
grade:      Assessment ──▶ Guard ──▶ 代码计算独立性 ──▶ commit
```

特征：**线性节点序列 + 一个条件分支（`needsRouteReview`）+ 一个有界重试（重写 ≤1）**。无扇出、无并行汇聚、无运行时生成的环。

## 3. 决策

**B01 不引入图执行引擎。** 四条工作流以 NestJS 领域服务中的显式顺序代码表达；节点级恢复通过 `StorePort.getReusableNode` / `saveNode` 实现。

六个角色各自是独立的 NestJS provider，拥有独立的输入输出 schema、上下文投影函数、提示版本和回归入口。

## 4. 理由

### 4.1 图执行引擎要解决的问题在此处不存在

LangGraph 提供两项能力：

1. **声明式条件路由** —— 本工作流仅有 `needsRouteReview` 与 `!guard.accept` 两个分支，`if/else` 已足够。
2. **节点粒度可恢复** —— 规格要求的节点复用**已经由 `ports.ts` 定义为 StorePort 语义**：

   ```ts
   getReusableNode(runId: string, nodeKey: string, inputHash: string): Promise<unknown | null>;
   saveNode(runId, leaseToken, nodeKey, inputHash, result): Promise<void>;
   claimRecovery(runId: string): Promise<ActiveRunContext | null>;
   ```

   对应 `contracts/database.sql` 的 `node_runs(run_id, node_key, attempt, input_hash, model_id, prompt_version, status, output_json, usage_json, ...)` 表。节点级恢复是**数据库契约的一部分**，不依赖任何图库。

### 4.2 规格自身限制了图库的价值

- `runtime.json` 设定 `checkpoint_authorizes_commit: false`，而业务事实来源是 MySQL 的 run/step/request/lease/fencing。引入 checkpoint 会造成**第二套状态**，与 `AGENTS.md` §7「不得形成第二套业务真相」冲突。
- `runtime.json` 设定 `node_retry_policy: "disabled_use_budgeted_ModelPort"`，图自带的重试须关闭，改由预算器统一记账。
- `README.md` 与 `AGENTS.md` §7 明确指出：**不存在经过验证的官方 LangGraph.js MySQL checkpoint saver**，社区实现不得默认采用。落 MySQL 需自研 `BaseCheckpointSaver` 薄适配，并覆盖 `workflow-persistence.md` §4 列出的全部一致性场景 —— 为一条线性流程承担该验证成本，收益不成比例。
- `runtime.json` 的 `recursion_limit: 32` 意在约束图失控；显式顺序代码不存在失控路径。

### 4.3 概念澄清：两层图不是执行图

`design-v6.md` §4.1 的「两层图」指：

- **解题依赖图**：决策节点、AND 前提、OR 路线
- **教学状态图**：诊断探针、局部补偿、回到主线、合并/跳过台阶

这两者是**由 MySQL 数据描述的业务对象**（落在 `packets.packet_json` 与 `probe_counters`），不是**执行编排的控制流**。混同二者会得出「因为业务有图，所以需要图引擎」的错误推论 —— 图引擎解决控制流问题，而此处复杂的是业务数据。

### 4.4 多 Agent 不由编排引擎定义

`design-v6.md` §5 对 Agent 的判据是「**独立目标、上下文边界、结构化结果和调度节点**」；`AGENTS.md` §7 补充「不能只在同一自由聊天提示里写四个名字冒充独立 Agent」。

该判据由契约、上下文投影函数、提示版本和审计记录满足，**与本 ADR 的选择无关**。图执行引擎既不提供、也不妨碍角色的独立性。

## 5. 后果

### 正面

- 不新增运行时依赖，不新增需要验证正确性的持久化适配器。
- 节点顺序、预算扣减、PolicyGate 顺序在代码中直接可读、可断点、可断言。AT13「不是一调用伪造四阶段」可通过在 `ModelPort` 上收集 `role` 调用序列直接证明。
- 与 `node_runs` 表、`StorePort` 契约一一对应，无中间层。

### 负面与缓解

- **拓扑不可视化**。缓解：四条工作流共约 15 个节点，控制流可在本文档与 `workflow-persistence.md` §1 中以文本完整表达。
- **若将来出现运行时生成的控制流，需手写调度器**。缓解见第 6 节。

## 6. 重评触发条件

当且仅当出现以下情况时，重新评估本决策：

**控制流无法在编译期枚举** —— 即下一节点由运行期数据决定，且分支集合不由固定枚举穷尽。

潜在触发点：B05「策略、动态台阶与路线构建」。但**触发前须先判定补偿节点的落点**：

- 若补偿节点是写入 `packets.packet_json` 的**路线图数据**（诊断结果驱动 PreparationAgent 产出 RoutePatch，经 Guard 校验后成为新版本 packet），则控制流仍是线性的，**本 ADR 继续成立**。
- 若补偿节点造成**执行流跳转**且可递归，则需引入图引擎。

判定方法：检查 turn 的节点序列是否仍能在编译期写出常量数组。

## 7. 相关决策

- **路由图存储**：采用 `qisi-sdd-v3/contracts/database.sql` 作为表结构基线，不新增表。路线结构存于 `packets(problem_hash, version, packet_json)` 版本化快照；goal 稳定性由 `probe_counters(session_id, task_id, canonical_goal_key)` 与其 `CHECK(shown_count BETWEEN 0 AND 2)` 约束保证。
- **RoutePatch 合并**：`applyRoutePatch(oldGraph, patch) -> newGraph` 实现为**应用层纯函数**，承载成环检测、悬空引用校验与终点归属校验，可独立单测。其输出为候选数据，经 Guard 校验后才成为新的 `packets` 版本行。
- **预算**：`BudgetLedger` 为 run 级单例，与 `runtime.json` 的 `workflows` 定义对应；`max_concurrent_model_calls = 4` 以信号量实现。
- **唯一提交点**：`StorePort.commitChecked`。任何节点结果、任何 checkpoint 均不构成业务提交。

## 8. 参考

- `qisi-sdd-v3/design-v6.md` §4、§5
- `qisi-sdd-v3/prd.md`、`qisi-sdd-v3/runtime.json`
- `qisi-sdd-v3/contracts/ports.ts`、`contracts/database.sql`、`contracts/workflow-persistence.md`、`contracts/README.md`
- `AGENTS.md` §3、§7、§9
- `ravenspec/changes/b01-agent-workflow-foundation/PRD.md`

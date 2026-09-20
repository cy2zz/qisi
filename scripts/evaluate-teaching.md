# 教学轨迹离线记账与盲化（B08）

基线 qisi-3.1。协议来源：`qisi-sdd-v3/acceptance/evaluation-protocol.md`。本工具不调用模型、不运行教学工作流、不验证评审者身份，不执行或宣告 AT51/52 通过。

## 命令

```text
node --test server/test/eval/evaluate-teaching.node.mjs
node scripts/evaluate-teaching.mjs <本地脱敏证据.json>
node scripts/evaluate-teaching.mjs <本地脱敏证据.json> --blind
```

盲化模式从环境读取 `QISI_EVAL_BLIND_SALT`（至少 32 字符，实际使用随机值；不可提交）。保留原展示顺序，按 HMAC 盲号排序系统轨迹。输入只能是已经安全投影的展示对话，**不得把原始 system prompt/CoT 放入 transcript**；工具白名单字段不等于对任意文本完成脱密审查。盲化后的 JSON 需再次人工核对再给评审者。

## 输入结构

顶层：`baseline: "qisi-3.1"`、`provider_mode: "fixture" | "real_model"`、`bank: {version,total}`、`planned`、`records`。

- `planned[]`：`case_id` 唯一，`task_id`，64 位小写十六进制 `input_hash`（同题、参考、学生输入脚本的冻结散列），`split: development | holdout`，`repetition >= 1`。所有预注册失败/未跑轨迹都留在此分母。不能跑完后删掉困难样本。
- `records[]`：同一 `case_id/arm` 仅一条；`arm: multi_agent | socratic`，相同的 `task_id/input_hash`，`model` 精确版本、`prompt_version`、`status: completed | preparation_failed | timeout | unknown | failed`。
- `config`：非负整数 `max_calls`、`input_tokens_cap`、`output_tokens_cap`、`deadline_ms`、`max_help_level`（0–4）；calls/deadline 必须大于零。
- `usage`：全部调用（含失败/修复/重写）的 `calls,input_tokens,output_tokens,elapsed_ms`；未知 usage 必须在原始审计中标记估计值来源，不能填零冒充实测。累计超过预算会在报告列出。
- `reviews`：0–2 个不同 `reviewer_id`，每个含完整 `counters`（字段以脚本导出的 `COUNTERS` 为准）。只有两份完全一致的计数进入已评指标；分歧保留，不由 LLM 仲裁。真实评审者身份、盲评过程及签名需另外保存授权证明，不在工具里伪造。
- `transcript`：按原展示次序，`{speaker:student|teacher|system,text_md}`；system 仅指用户可见状态消息，不是私有模型提示。

可运行的数据形状示例在 `server/test/eval/evaluate-teaching.node.mjs`；其中 reviewer、模型、题目和计数全是合成单测数据，**不可当作评测结果**。

## 报告边界

逐系统保留 planned/observed/missing、各失败状态、unknown、人工分歧、保护违规、额外追问、独立决策/检验、总成本。比率显式给分子分母；零分母返回 null。同题但模型/预算不同的两组列为不可比；报告不计算“提升百分比”，也不宣称统计或因果优势。失败轨迹的已发生评审机会可记账，但必须连同失败/缺失分母呈现，不能只摘取已评正确率。

`STRONG_SOCRATIC_BASELINE` 是基线提示候选，尚未实测。强基线需同数学参考、同学生证据、同安全限制、同最大帮助等级、同模型和两组**总**预算，不能用弱提示制造优势。

## 真评测仍需执行

冻结题库 manifest 和抽样 seed（至少 12 题或小库全量），记录类型缺口；冻结两组输入/配置、角色正反例、BT01–16 与每类关键风险至少 3 次；实际运行后脱敏，两个真实独立评审者盲评，保留分歧和修复前失败；另跑未参与调参的 holdout。工具目前不自动证明这些覆盖门槛，发布清单必须人工核验。

## 延迟统计

每个实验臂的 `latency_ms` 使用全部已观察执行（包括失败、超时）的 `usage.elapsed_ms`，升序排列后以 nearest-rank 方法取第 `ceil(p × n)` 个值，报告 p50/p95（毫秒）。同时报告 `observed` 和 `missing`；未运行轨迹不补零，无观察值时两个分位数均为 `null`。这不是完整计划样本的延迟估计，也不证明服务端端到端耗时已被真实采集。

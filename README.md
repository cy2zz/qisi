# 启思｜AI 高中数学思维老师

> 工作区整理日期：2026-09-16。**当前唯一实施基线：`qisi-3.0`，目录为 `qisi-sdd-v3/`。**
> 本工作区是设计方案和 SDD 开发规格，不是已经实现的 Web 应用。不要把规格校验通过当成应用验收通过或学生已经学会。

## 1. 从哪里开始

| 你要做什么 | 阅读入口 |
| --- | --- |
| 理解产品与多 Agent 设计 | [设计方案 V6](qisi-sdd-v3/design-v6.md) |
| 查看两个人约十天的分工与联调规划 | [开发规划 V3](qisi-sdd-v3/plan.md) |
| 把任务交给 AI 一步步实施 | [SDD PRD V3](qisi-sdd-v3/prd.md) + [开发约束](qisi-sdd-v3/AGENTS.md) |
| 查任务、契约、验收 | `qisi-sdd-v3/tasks.json`、`contracts/`、`acceptance/` |
| 向他人交付完整规格 | `qisi-sdd-v3.zip` |
| 查原始方案与调研来源 | [研究资料索引](research-evidence/README.md) |
| 查本次删除和迁移明细 | `cleanup-report.json` |

产品目标是**识别学生的数学思维卡点，通过动态教学台阶启发学生自主完成，并在撤去帮助后验证独立执行与迁移**，不是展示解题答案。

- 两位开发者 A/B，约 10 个开发日；同仓全栈 Web，页面与服务端功能一起开发、联调，不做原生客户端或独立前后端项目。
- 从题库随机或指定选题，不靠固定演示题，也不能因准备失败静默缩小题池或换题。
- 产品采用 Preparation、Diagnosis、Strategy、Assessment 四个专职 Agent，配合 Renderer/Guard 和受控工作流。
- 输入支持 Markdown / LaTeX 与手写图片；手写先转写并由学生确认，再进入诊断。
- 展示教学决策依据和证据摘要，不展示模型隐藏思维链。
- 多 Agent 是产品能力；是否让开发 AI 并行工作，是另一个需要明确授权与写入范围的决定。

## 2. 整理后的目录

```text
D:/math/
├── README.md                    # 工作区总入口（本文件）
├── qisi-sdd-v3/                  # 唯一有效的 qisi-3.0 规格与发布工作区
│   ├── README.md / AGENTS.md     # 规格说明 / AI 开发约束
│   ├── design-v6.md              # 产品设计
│   ├── plan.md / prd.md          # 开发规划 / 可执行 PRD
│   ├── requirements.json        # P0 需求
│   ├── tasks.json               # A01–A10、B01–B10 任务卡
│   ├── traceability.csv         # 需求—任务—验收追溯
│   ├── contracts/               # Schema、接口、状态与数据约束
│   ├── acceptance/              # 验收案例、评测协议、结果模板
│   ├── fixtures/                # 自拟正反例与轨迹，不冒充高考题或学生数据
│   ├── prompts/                 # 产品 Agent 与 A/B/单开发者启动指令
│   ├── changes/ / handoffs/      # 变更与交接模板
│   ├── evidence/                # 随规格分发的精简开源证据
│   ├── scripts/                 # 规格验证、语义规则、打包工具
│   ├── publication/             # 发布工具、现行发布输入、备份与成功凭证
│   └── manifest.json            # 固定交付文件清单及 SHA256
├── qisi-sdd-v3.zip               # 已发布的完整规格附件，不是应用安装包
├── research-evidence/            # 原始方案、历史调研、来源快照与采集脚本
├── cleanup-report.json          # 本次清理路径、理由、哈希及验证记录
└── .claude/                      # 原有工具配置，未修改
```

`qisi-web/` 尚未创建。后续应用按规格默认实现到 `D:/math/qisi-web`；若届时已有代码，先检查和适配，不清空或覆盖。

## 3. 如何交给开发 AI

1. 先阅读 `qisi-sdd-v3/README.md` 和 `AGENTS.md`，确认这是规格而非现成应用。
2. 阅读 `design-v6.md`、`plan.md`、`prd.md`，再查看 `tasks.json` 中任务的依赖与 owner。
3. 根据开发模式选择启动指令：
   - 开发 A：`prompts/developer-a.md`，从 A01 起步。
   - 开发 B：`prompts/developer-b.md`，从 B01 起步。
   - 单个 AI：`prompts/developer-single.md`，按依赖交替实施 A/B 任务。
4. 每张任务卡结合 `contracts/README.md`、相关 Schema、`acceptance/cases.json` 和 fixture 执行：变更说明 → 失败测试 → 实现完整功能 → 联调验收 → 记录证据 → 交接复核。
5. 严守写入范围：A 负责全局配置、共享基础、题库/输入/评估/报告/历史及 AssessmentAgent；B 负责契约、工作流、其余 Agent、教学与教师视图。精确归属以任务卡和 `AGENTS.md` 为准。

**不能仅凭页面、Mock 对话或静态 Schema 检查宣布完成。** 主办方题库、模型 Key、部署环境仍需提供；缺少外部条件时据实标记，不用自拟数据冒充真实评测。规格中的应用 npm 命令需要在开发任务中实现，并非在本目录已可直接运行。

## 4. POPO 文档与本地交付状态

以下是**本地保存的最近一次成功发布记录**，回读校验时间为 **2026-09-16 11:10:16（Asia/Shanghai）**。本次目录清理没有重新联网回读，也没有修改在线文档。

| 文档 | 在线地址 | 对应本地文件 |
| --- | --- | --- |
| 多 Agent 数学思维老师设计方案 V6 | [打开 POPO](https://docs.popo.netease.com/lingxi/a3ceafa9c4ac4a1ebab7ebd04068a9c2) | `qisi-sdd-v3/design-v6.md` |
| 双人约十天开发规划 V3 | [打开 POPO](https://docs.popo.netease.com/lingxi/98264ae3b38941a5aaf1b62e59abc31c) | `qisi-sdd-v3/plan.md` |
| 多 Agent Web SDD PRD V3 | [打开 POPO](https://docs.popo.netease.com/lingxi/0de4566fcbef4f9ebd7f9e474cf4b718) | `qisi-sdd-v3/prd.md` |

PRD 已附本地同一份 ZIP。权威发布凭证位于 `qisi-sdd-v3/publication/`：

- `live-publication-status.json`：最近一次实际发布状态 `published_and_verified`。
- `publication-verification.json`：三份文档标题、正文、表格、代码、链接及附件的回读比较结果。
- `documents.json`、`attachment.json`：文档 ID 与附件地址、大小、哈希。
- `*-prepublish.json`：覆盖前备份；`*-update.json`、`*-readback.json/html`：成功响应与最终回读内容。
- `package-verification.json`、`extracted-package-check.json`：ZIP 与独立解压验证记录。

**版本说明：** ZIP 内的 `publication/publication-status.json` 只是固定的发布目标元数据，不代表尚未发布。规格包 README 中打包时留下的“线上尚未读取/同步”描述属于历史快照；后续同步状态以包外 `live-publication-status.json` 和回读报告为准。本次没有为改写历史状态而修改已发布快照。

发布工具 `run-popo.mjs`、`build-document.cjs`、`sync-publish.cjs`、`verify-publication.cjs` 及其必要输入继续保留。不应为目录清理而运行发布脚本；重新发布需明确授权、有效登录及写前并发编辑检查。

## 5. 完整性与验证

已发布 ZIP 固定信息：

- 文件：`qisi-sdd-v3.zip`
- 大小：227,571 字节
- 内容：83 个文件（82 个清单文件 + `manifest.json`）
- SHA256：`d4f62ea542b0c969e3ea6afade3377a9d20b2e41e7e5a32bbb98d71c75aca23b`

只读检查 ZIP 哈希：

```powershell
Get-FileHash -LiteralPath 'D:\math\qisi-sdd-v3.zip' -Algorithm SHA256
```

规格验证入口是 `qisi-sdd-v3/scripts/validate_spec.py`，Python 依赖声明在 `requirements-dev.txt`。**验证脚本会重写 `spec-validation.json`，打包脚本会重写 manifest 和 ZIP。** 为保持已发布文件一致，复验应把 ZIP 解压到独立临时目录，再执行该副本的 `python -B scripts/validate_spec.py`，不要直接重写交付目录。

本次已在临时解压副本中重新通过 **647 项规格检查，0 失败**，并离线重建、比较三份发布正文，全部通过；临时副本已清理，详情见 `cleanup-report.json`。647 项检查的含义仅是规格结构、引用、夹具与部分语义约束一致；不等于已运行 Web、真实模型或学生学习实验。开源复用方案仍是 planned，不能当成已安装、实测可用的依赖清单。

## 6. 本次清理了什么

共删除 **334 个冗余文件，合计 3,903,772 字节（约 3.72 MiB 文件内容）**，另迁移整理 10 个独有资料文件。此数字是删除文件的大小之和，不是文件系统实际释放空间；本次新增的 README 与清理记录另占少量空间。

- 删除被替代的 `qisi-sdd/`、`qisi-sdd-week1/` 及其旧 ZIP。
- 删除两份 `qisi-*-check-*` 独立解压副本和 Python 缓存。
- 删除根目录旧版设计、旧发布响应、旧构建与验证脚本。
- 删除现行目录中不属于交付包的一次性规格生成/修补脚本，以及空文件、失败同步记录和重复的发布前快照。
- 根目录重复的来源核查文档与现行 `evidence/source-audit-previous.md` 完全相同，因此仅保留后者。
- 原始方案/调研 JSON 和 Markdown、评审稿、采集脚本，以及从旧目录找出的三份独有技术文档快照，集中保留到 `research-evidence/`；迁移前后哈希一致。

没有改动当前规格清单内文件、已发布 ZIP、最新成功发布凭证或 `.claude` 配置。研究原始证据与包内精简证据有少量有意重复：前者用于溯源，后者确保 ZIP 能独立交付，不作为垃圾删除。

完整删除清单及删除前哈希见 `cleanup-report.json`；它是审计记录，不是旧文件备份。

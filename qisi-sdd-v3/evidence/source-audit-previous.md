# 「启思」方案：来源与开源质量核查记录

核查日期：2026-09-15。配套方案：`ai-math-tutor-review-v2.md`。

## 核查方式与边界

本次已完成：
- 通过 POPO CLI 读取用户指定的两份原文；
- 直接下载相关论文原文/摘要、官方 GitHub README、许可证、仓库目录、模型卡；
- 定向抽查 SocraticAI 应用与依赖、Pix2Text 公式测试、诊断 skill 的 EVALS、SymPy 解析安全说明；
- 保存证据文件与部分仓库 HEAD 标识，便于回查。

本次**没有**完成：
- 安装这些项目、下载全部模型、在比赛设备上测试 OCR/推理速度；
- 执行全部单元测试、完整源码/安全审计；
- 用真实中国高中生验证教学效果或统计学习增益；
- 对所有模型权重、数据集、依赖树出具许可证合规结论。

联网检索工具未返回可用结果，GitHub 未认证 API 触发限流；因此采用经授权的直接 HTTP 获取官方页面/原始文件。下列判断以实际保存的内容为准，不靠搜索摘要或 star 数量。没有把“找到 tests 文件夹”当作“测试全部通过”。

## 质量判定方法

对本次原型，顺序应是：
1. **适配性**：究竟是数学求解器、OCR、prompt、评测框架还是教学引擎？
2. **证据**：论文/可复現评测、可读源码、测试断言、失败案例是否存在？
3. **接入成本**：当前依赖、GPU、模型下载、平台适配、接口稳定性；
4. **使用条件**：代码、模型权重、数据分别核对；
5. **维护状态**：归档、停止维护、发布说明及 issue/PR 处理需分开看；
6. **本地验证**：固定版本，用本项目的手写与教学案例实测。

没有对未检查的维度编造分数。AGPL/GPL/CC 等标注是仓库证据，不是对具体产品使用方式的法律意见。

## 选型总表

| 项目 | 查到的质量信号/风险 | 复用决定 | 来源 |
|---|---|---|---|
| KaTeX / react-markdown | 官方源码、渲染能力明确，核心仓库 MIT | 直接接入渲染；其余插件按锁定版本核许可证 | S3 |
| SymPy | BSD 三条款、工具文档明确；`parse_expr` 对不可信输入有警告 | 限定表达式和题目校验函数 | S4 |
| Pix2Text | MIT；模型卡标明公式 OCR；有 docs/tests；抽查测试主要执行和打印结果 | P1 备选，先实测真实手写 | S5 |
| Texo / Texo-web | 小模型和浏览器路径明确；有基准表；两个仓库均 AGPL-3.0 | 不设为 P0 必备离线兜底 | S6 |
| universal-diagnostic-tutor-skill | MIT、Markdown-only；有行为规范和情景评测文档 | 借鉴清单、失败场景；不作诊断服务依赖 | S7 |
| SocraticLM | 论文关联明确；代码 Apache-2.0，数据/weight diff CC BY-NC 4.0 | 借鉴研究设计，不在比赛周训练部署 | S8 |
| Mr. Ranedeer | README 首行 DISCONTINUED；主要是提示文件；未在检查位置找到 LICENSE | 不作底座，不以高 star 替代质量验证 | S9 |
| SocraticAI | 多 AI 对话示例；MIT；旧依赖；关键教学闭环需自建 | 不直接 fork 为本项目主架构 | S10 |
| LaTeX_OCR_PRO | GPLv3；文档要求 Python 3.5 / TensorFlow 1.12.2 | 不选；迁移成本违背本次省时原则 | S11 |
| texify | 已归档/弃用；代码 GPLv3、模型卡说明权重 CC BY-SA 4.0 | 不新增依赖 | S12 |
| math-question-bank | AGPLv3；题库/组卷/导出定位；docs/tests/CI 结构 | 后续备课工具候选，不接入 P0 | S13 |
| NuminaMath | 真实模型卡和竞赛代码可定位；不等同教学系统 | 非 P0 必需；仅作未来求解器候选 | S14 |
| MathTutorBench | 正确论文、官方评测代码、任务与奖励模型说明 | 参考评测/按需跑子任务，不当实时教学引擎 | S2 |

## S1 — 学习实验：不要把护栏效果等同于学习增益

论文：Bastani 等，*Generative AI without guardrails can harm learning: Evidence from high school mathematics*，PNAS，2025；DOI `10.1073/pnas.2422633122`。

原始论文全文保存为 `research-evidence/pnas-fulltext.txt`，书目信息为 `research-evidence/pnas-pmc-search.txt`。

```text
https://www.pnas.org/doi/10.1073/pnas.2422633122
https://pmc.ncbi.nlm.nih.gov/articles/PMC12232635/
https://www.ebi.ac.uk/europepmc/webservices/rest/PMC12232635/fullTextXML
```

出版社网页返回 403，读取的是 Europe PMC 提供的该原始论文全文 XML。所用组别与统计结论见方案第 1.1 节；这是特定实验情境，不是对所有 AI 教育产品的统一结论。

## S2 — MathTutorBench：正确编号、任务结构和复用边界

正确论文：*MathTutorBench: A Benchmark for Measuring Open-ended Pedagogical Capabilities of LLM Tutors*，arXiv `2502.18940`。

原稿编号 `2504.08649` 的实际标题为 *Infinite unrestricted sumsets in subsets of abelian groups with large density*，不相关。

官方 README 概述为三类高层能力、七项具体任务：problem solving、Socratic questioning、student solution correctness、mistake location、mistake correction、scaffolding generation、pedagogy following；此外有困难版本。不是“八维学生根因诊断标准”。README 标注 CC BY 4.0；采用具体数据/模型时仍需检查各资源标注。

```text
https://arxiv.org/abs/2502.18940
https://arxiv.org/html/2502.18940v1
https://github.com/eth-lre/mathtutorbench
https://arxiv.org/abs/2504.08649
```

证据：`mathtutor-abstract.txt`、`mathtutor-paper.txt`、`mathtutor-readme.txt`、`mathtutor-tree.txt`、`arxiv-2504.08649.html`。均位于 `research-evidence/`。

适合借鉴错误定位与教学回复评测。没有在此项目中重新验证其奖励模型对中文高中数学、手写输入及本次三项评分的适用性。

## S3 — 渲染基础组件

KaTeX 与 react-markdown 的官方源码和许可证已获取。react-markdown 文档包含数学插件集成示例。这里采用的是渲染能力，不是解题/数学验证能力。

```text
https://github.com/KaTeX/KaTeX
https://github.com/KaTeX/KaTeX/blob/main/LICENSE
https://github.com/remarkjs/react-markdown
https://raw.githubusercontent.com/remarkjs/react-markdown/HEAD/readme.md
https://raw.githubusercontent.com/remarkjs/react-markdown/HEAD/license
```

证据：`KaTeX__KaTeX.README.md/.LICENSE/.page.html`、`react-markdown-readme.txt`、`react-markdown-license.txt`。

未安装、未验证选定插件版本组合；实施时锁依赖并测中文混排、多行公式、非正常 LaTeX、XSS 输入。

## S4 — SymPy：用途与不可信输入边界

官方仓库许可为 BSD 三条款。官方解析文档对 `parse_expr` 明确说明使用 `eval`，不应用于未净化输入；Gotchas 文档解释符号相等判断并非简单的字符串/结构比较。

```text
https://github.com/sympy/sympy
https://docs.sympy.org/latest/modules/parsing.html
https://docs.sympy.org/latest/tutorials/intro-tutorial/gotchas.html
```

证据：`sympy__sympy.LICENSE`、`sympy-parse-doc.txt`、`sympy-gotchas-doc.txt`。

“两个答案一致”或有限数值代入，不能代替对所有定义域/推理步骤的证明。该项是逻辑与工程边界判断，不是声称 SymPy 能验证任意高中证明。

## S5 — Pix2Text

查到：代码 MIT；所查 `breezedeus/pix2text-mfr` 模型卡标注 MIT，定位为公式图转 LaTeX。仓库有中文/英文文档、布局/文本公式相关能力及 tests。所查 `tests/test_latex_ocr.py` 主要执行识别、打印或记录结果，未提供这里所需的中文手写误诊率断言。

```text
https://github.com/breezedeus/Pix2Text
https://github.com/breezedeus/Pix2Text/blob/main/tests/test_latex_ocr.py
https://huggingface.co/breezedeus/pix2text-mfr
```

证据：`breezedeus__Pix2Text.*`、`pix2text-requirements.txt`、`pix2text-formula-test.txt`、`pix2text-model-card.txt`。

适配判断：比老 OCR 工程更值得进入候选，但完整中文手写推导涉及版面、行关系、文字与公式，不应将单公式模型性能直接外推。整个部署依赖及其他模型要另查许可证。

## S6 — Texo / Texo-web

查到：Texo README 描述 20M 参数 LaTeX OCR；基准表含不同模型版本与 ONNX 版本，不能混用数值。Texo-web 是 Nuxt 实现，列出模型加载等功能。两个仓库的 LICENSE 都为 GNU AGPL v3。

```text
https://github.com/alephpi/Texo
https://github.com/alephpi/Texo-web
https://arxiv.org/abs/2602.17189
```

证据：`alephpi__Texo.*`、`alephpi__Texo-web.*`、`arxiv-2602.17189.html`、`texo-paper.txt`。

适配判断：单公式浏览器推理是有价值的候选，但“浏览器可运行”不自动等于“现场断网可用”；必须预先缓存模型、WASM/运行时/字体并实测比赛设备。未做速度、内存和手写整页准确率测试。

## S7 — Universal Diagnostic Tutor Skill

查到：MIT；README 明示 Markdown-only 行为层，不是课程平台、数据库或隐藏记忆服务；主要覆盖大学 STEM/AI-CS。EVALS 给出情景、期望行为、失败信号及评分说明。

```text
https://github.com/SenmuuuuW/universal-diagnostic-tutor-skill
https://github.com/SenmuuuuW/universal-diagnostic-tutor-skill/blob/main/EVALS.md
```

证据：`SenmuuuuW__universal-diagnostic-tutor-skill.*`、`diagnostic-evals.txt`。

适合改写为高中数学的诊断清单与回归用例。不把行为规范当作已经实证有效的诊断模型。

## S8 — SocraticLM

查到：NeurIPS 2024 论文相关仓库；SocraTeach 数据与训练代码。README 和子目录许可证显示代码 Apache-2.0，数据与 weight diff CC BY-NC 4.0。不能把“代码开放”理解为全部数据、衍生权重同样许可。

```text
https://github.com/Ljyustc/SocraticLM
https://github.com/Ljyustc/SocraticLM/tree/main/LICENSE
https://proceedings.neurips.cc/paper_files/paper/2024/file/9bae399d1f34b8650351c1bd3692aeae-Paper-Conference.pdf
```

证据：`Ljyustc__SocraticLM.README.md/.page.html`、`socraticlm-code-license.txt`、`socraticlm-data-license.txt`、`socraticlm-weight-license.txt`。

本次只核查 README/许可与项目定位，没有重跑论文或评测其模型。各新发布权重需要独立核查，不能把 weight diff 的许可自动套用到所有模型。

## S9 — Mr. Ranedeer

查到：README 首行 `DISCONTINUED`。仓库主体为 tutor prompt、扩展与指南；检查根目录及 `LICENSE`、`LICENSE.md` 未找到明确许可证文件，这不是对所有文件授权状况的最终判断。

```text
https://github.com/JushBJJ/Mr.-Ranedeer-AI-Tutor
```

证据：`JushBJJ__Mr.-Ranedeer-AI-Tutor.README.md/.page.html`。

判断：可了解其交互思想，但不作为维护可靠的应用底座，也不在许可不明时直接复制大量内容。高 star 不改变上述边界。

## S10 — SocraticAI

查到：MIT；多 AI 参与的 Socratic 对话示例。抽查依赖有 `Flask==2.2.3`、`openai==0.27.4`，需要迁移评估；README 说明内容/代码由模型生成，但这不是判定质量差的充分条件。

```text
https://github.com/RunzheYang/SocraticAI
https://github.com/RunzheYang/SocraticAI/blob/main/app.py
https://github.com/RunzheYang/SocraticAI/blob/main/requirements.txt
```

证据：`RunzheYang__SocraticAI.*`、`socratic-app.txt`、`socratic-requirements.txt`。

判断：主要问题是与赛题目标和时间预算不匹配，而非“多 Agent 一定无用”；诊断证据、学生独立表现与撤架检验仍需另建。

## S11 — LaTeX_OCR_PRO

查到：GPLv3；README 环境要求 Python 3.5 + TensorFlow 1.12.2，虽然定位包含中文/手写公式，接入一个现代比赛原型需要较明显的兼容性工作。

```text
https://github.com/LinXueyuanStdio/LaTeX_OCR_PRO
```

证据：`LinXueyuanStdio__LaTeX_OCR_PRO.README.md/.LICENSE/.page.html`。

判断：不选，不代表它在任何环境都不能运行；本次未安装，不编造失败日志或准确率。

## S12 — texify

官方仓库页标记：2025-01-29 归档。README 明示 deprecated，功能迁至 surya。代码 LICENSE 为 GPLv3；README 的商业使用说明称模型权重 CC BY-SA 4.0。

```text
https://github.com/VikParuchuri/texify
```

证据：`VikParuchuri__texify.README.md/.LICENSE/.page.html`、`texify-pyproject.txt`。

判断：不新增依赖。没有因此自动推荐 surya；替代项目仍需单独核查任务适配性、部署成本与许可。

## S13 — math-question-bank

查到：AGPLv3；高中题库、备课组卷、OCR、试卷导出等功能；仓库中存在 `tests` 与 `.github/workflows`，README 说明开发测试依赖与锁定版本。部分导出/TikZ 功能需额外 LaTeX 工具链。

```text
https://github.com/JudgePeach/math-question-bank
```

证据：`JudgePeach__math-question-bank.README.md/.LICENSE/.page.html`。

判断：值得作为以后教师备课工具的候选，但一个固定题目的教学闭环不需要引入整个题库平台。未运行 CI，不宣称测试覆盖充分或全部通过。

## S14 — NuminaMath

原文将 `AI-MO/NuminaMath` 当作明确的 GitHub 求解器项目，定位不够准确。本次对该 GitHub 路径未取得可用仓库；已确认的资源是 HF `AI-MO/NuminaMath-7B-TIR` 模型卡和 `project-numina/aimo-progress-prize` 官方竞赛实现。模型卡标注 Apache-2.0。

```text
https://huggingface.co/AI-MO/NuminaMath-7B-TIR
https://github.com/project-numina/aimo-progress-prize
```

证据：`numina-model.txt`、`numina-repo.txt`。

判断：求解模型/训练与竞赛推理工程，不是现成高中思维老师。对本次预先审核的一题原型，没有必要为其增加本地 GPU 服务；也未验证其中文教学表现。

## S15 — 用户原 PRD

标题：「启思」AI数学思维教练-产品方案PRD。

```text
https://docs.popo.netease.com/lingxi/09c180e8d6ca46fda20cd7f40ee6c5e2
```

原始副本：`qisi-prd-source.json`、`qisi-prd-source.md`。只读取，未修改原在线文档。

## S16 — 用户原调研

标题：AI数学思维教练-市面产品与开源实现调研。

```text
https://docs.popo.netease.com/lingxi/4feeb900cc5b4a0a8b1bf06d3c695cd3
```

原始副本：`qisi-research-source.json`、`qisi-research-source.md`。只读取，未修改原在线文档。

## 进入实施前的两道门

**门 1：技术组件**
- 固定 commit/包版本与模型 revision；
- 核对具体依赖和模型许可；
- 干净环境安装；
- 用项目代表性输入测功能、冷启动、超时、失败行为；
- 结果不过关就保持人工转写/API 后备，而不是承诺已实现离线兜底。

**门 2：教学闭环**
- 由能够审核高中数学的人确认题目包；
- 让同一模型分别跑直接解题、仅 prompt 引导、V2 三条路径；
- 用未参与调优的案例检查诊断、过度帮助、替代解法与手写歧义；
- 有真实学习者数据前，不宣传提升考试成绩。

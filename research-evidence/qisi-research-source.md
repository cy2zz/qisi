# AI 数学思维教练 — 市面产品与 GitHub 开源实现调研

> 调研目标：为「AI 如何培养用户数学思维」赛题做技术选型参考，覆盖市面同类产品与 GitHub 高 star 开源实现。
> 调研日期：2026-09-14

## 一、业务背景回顾

*   LLM 已能求解中高考数学题，但研究表明：AI 直接辅助使学生作业效率/得分提升，考试成绩反而下降。
*   根因判断：AI 介入干扰了学生深入思考，弱化思维能力培养。
*   优质 1对1 真人家教能现场诊断 + 引导启发，但资源稀缺、成本高昂。
*   赛题三大痛点：
    1.  教学过程中 AI 如何识别用户思维卡点，并高质量干预；
    2.  用户如何感知到是在培养思维，而不是给答案步骤；
    3.  AI 在此过程中的能力如何体现。
*   评审维度：① 诊断出学生薄弱点 ② 教学步骤合理 ③ 重视学生自主性。

## 二、市面相关产品（Socratic 式 AI 家教赛道）

### 海外

| 产品                                      | 核心做法                                              | 与本题的关联                             |
| --------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| Khanmigo（Khan Academy）                  | GPT-4 驱动，定位"不给答案，只追问引导"（Socratic），逐步 hint         | 与痛点 1:1 对应，行业标杆；但昂贵、未开放            |
| ChatGPT Study Mode（OpenAI 2025）         | 系统级"学习模式"：先诊断水平，再分段引导、主动提问、拒绝直接给答案                | 证明"防代做"已是平台级功能，可作交互范式参考            |
| Claude Learning Mode（Anthropic）         | learning\_style system prompt：让学生自己动手，AI 只点拨关键步骤  | 同上                                 |
| Google LearnLM / Gemini Guided Learning | LearnLM 是专为"教学行为"（pedagogy）微调的模型，提出 pedagogy 评测维度 | "AI 能力如何体现"的最强背书：模型层而非 prompt 层做教学 |

### 国内

| 产品                          | 说明                                 |
| --------------------------- | ---------------------------------- |
| 学而思九章 MathGPT / MathGPT Pro | 自研教育大模型，主打"启发式讲解"而非直接答案，有拍照手写识别    |
| 猿辅导海豚 AI（Dolphin AI）        | 主打"苏格拉底式追问 + 个性化引导"，1对1 AI 老师      |
| 豆包爱学 / 作业帮银河大模型             | 拍照答疑 + 引导式讲解，覆盖手写 OCR              |
| 松鼠 AI                       | 知识点图谱 + 自适应诊断，"测—学—练"闭环，薄弱点诊断思路可借鉴 |

## 三、关键研究（可写进方案背景）

*   **UPenn Wharton《Generative AI Can Harm Learning》（Bastani et al., 2024）**：土耳其高中实验，GPT-4 tutor 使练习成绩 +48%，但考试成绩下降 17%——正是赛题背景引用的现象；加"守护性 prompt（不给答案）"可消除大部分负面影响。
*   **MathTutorBench（2025 benchmark, arXiv 2504.08649）**：评测 LLM"教学能力"（mistake identification、pedagogical instruction、scaffolding 等 8 个维度），是诊断/教学步骤打分的现成评测框架。
*   **Google LearnLM 论文**：pedagogy 能力靠 system prompt 只能小幅提升，微调提升显著——原型期用 prompt + 多 agent 结构化是性价比最高的路线。

## 四、GitHub 高 star 相关实现

| 仓库                                                | Stars       | 与本题的关系                                                                 |
| ------------------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| JushBJJ/Mr.-Ranedeer-AI-Tutor                     | 29.6k       | 最火的 GPT-4 AI 家教 prompt 工程：可配置深度/风格/学习计划，纯 prompt 实现"分层引导"，最适合参考其教学策略编排 |
| breezedeus/Pix2Text                               | 3.2k        | 手写/印刷数学公式 OCR → LaTeX/Markdown，Mathpix 免费替代，直接解决手写输入需求                 |
| LinXueyuanStdio/LaTeX\_OCR\_PRO                   | 1.3k        | 中英文手写公式识别，基于 LaTeX AST                                                 |
| VikParuchuri/texify                               | 1.1k        | 数学 OCR 模型（已归档，被 surya/marker 收编，模型可用）                                  |
| alephpi/Texo                                      | 0.9k        | 仅 20M 参数的 LaTeX OCR，可在浏览器端运行，演示现场免 GPU                                 |
| ChenChenyaqi/learn-anything                       | 446         | Socratic 深挖 + TDD 式练习的学习 agent skill                                   |
| JudgePeach/math-question-bank                     | 229         | 高中数学题库管理 + LLM 解析 + 公式 OCR，国内向实现                                       |
| RunzheYang/SocraticAI                             | 260         | 多 agent（导师/评论家/求解者）苏格拉底式解题                                             |
| Ljyustc/SocraticLM                                | 179         | 论文复现：微调出"像苏格拉底导师一样思考"的 LLM                                             |
| SenmuuuuW/universal-diagnostic-tutor-skill        | 205         | 诊断优先教学 skill：先查错因再教概念，与"诊断薄弱点"维度完全对齐                                   |
| 参考：AI-MO/NuminaMath、microsoft/autogen 内置 MathChat | \~1k / 40k+ | 高考级数学推理模型与多 agent 数学对话框架                                               |

## 五、结论与建议

1.  **没有现成开源项目完整覆盖三个评审维度**——高 star 项目要么是"通用 AI 家教 prompt"（Mr.Ranedeer），要么只有 OCR/推理单点；"诊断卡点 + 教学策略编排 + 推理过程可视化"的组合正是差异化空间。
2.  **推荐技术栈组合**：手写输入用 Pix2Text/Texo（浏览器端）或直接多模态大模型；教学大脑用多 agent（诊断 agent → 教学策略 agent → 讲解 agent），参考 SocraticAI/SocraticLM 结构；评测对齐 MathTutorBench 维度，演示时天然支撑"推理细节展示"。
3.  **产品交互范式**直接对标 Khanmigo / Study Mode：分层提示（hint ladder）、追问式输出、明确"这步让你自己算"的界面语言——这正是"让用户感知到在培养思维"的低成本手段。

## 六、技术框架要点（结论摘要）

*   核心设计原则：把"会解题"和"会教学"拆成两个角色，把"诊断"做成结构化数据，把"教学策略"做成显式状态机。
*   分层：输入归一化（手写图→LaTeX）→ 步骤对齐器 → 诊断 Agent（强制 JSON）→ 教学策略状态机（澄清追问/提示L1/L2/L3/演示/重做）→ 护栏校验（sympy 判等 + 答案泄露过滤）→ 会话状态库。
*   痛点 1 解法：离线专家解法步骤图 + 在线"对齐 + 归因"，诊断依据是与标准步骤图的偏差，非 LLM 拍脑袋。
*   痛点 2 解法：提示阶梯显式编号、必须先提交尝试才解锁下一级、答案泄露过滤器、自主步骤进度条、结束弱点报告。
*   痛点 3 解法：教练视角抽屉展示每轮完整决策链（识别→对齐→诊断 JSON→动作选择理由→话术），直接对应三个评分维度。
*   复用 vs 自建：OCR/KaTeX/sympy/多模型接入/NuminaMath 直接复用；Mr.Ranedeer/SocraticAI/SocraticLM/诊断 skill 参考改造；步骤图/对齐器/诊断 Agent/状态机/护栏/教练视角为必须自建的核心差异化。
*   总工作量：2-3 人 × 5-7 天可出可演示版本。

## 七、参考资料

*   论文：Bastani et al., Generative AI Can Harm Learning (Wharton, 2024)；MathTutorBench (arXiv 2504.08649)；Google LearnLM 技术报告
*   产品：Khanmigo、ChatGPT Study Mode、Claude Learning Mode、Google Guided Learning、学而思九章、猿辅导海豚 AI、豆包爱学、松鼠 AI
*   开源：见第四节仓库清单



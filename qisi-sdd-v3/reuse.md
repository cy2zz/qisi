# 开源复用与落地清单｜qisi-3.0

## 1. 结论与证据等级

采用“复用通用工程能力，自研教学判据和状态”的组合，不从零造Markdown、公式渲染、测试或数据库，也不把不符合要求的聊天Demo整仓fork进来。

证据等级：E0=候选，未完成源码核验；E1=已读取本地归档README/许可；E2=已安装锁定版本并跑目标环境烟测；E3=业务负例、恢复和安全测试通过。本规格包不声称任何组件已经达到E2/E3。

2026-09-15本轮公开网页查询没有返回可用结果，网络请求未连通。因此下述E1沿用同日此前保存在research-evidence中的原始快照，不声称最新版本、持续维护状态或漏洞检查通过。D1必须实际生成reuse-lock.json，版本号和commit不得猜测。

## 2. 精确到开发任务的复用表

| 组件/仓库 | 决定与等级 | 复用什么/不复用什么 | 负责人、落点与准入测试 |
| --- | --- | --- | --- |
| vercel/next.js + facebook/react | 基线框架；E0，实际依赖需准入 | 同仓页面、Server Actions/Route Handlers；不用独立后端服务 | A01；src/app；build、SSR/客户端边界、真实持久化刷新 |
| remarkjs/react-markdown | 选用；E1，本地license为MIT | 安全Markdown AST渲染；不开rehype-raw | A01；src/shared/ui/MathMarkdown.tsx；XSS、链接、中文公式、异常输入 |
| remarkjs/remark-math + remarkjs/remark-rehype相关生态 | 选用插件候选；E0 | 数学语法识别，锁与react-markdown兼容版本 | A01；同上；行内、多行、转义符和超长公式 |
| KaTeX/KaTeX + rehype-katex | KaTeX E1，本地许可MIT；插件E0 | LaTeX渲染，不是数学判题器；trust=false，throwOnError=false | A01；字体随构建打包，不依赖现场CDN；危险命令与渲染失败保留原文 |
| colinhacks/zod | 选用；E0 | 运行时结构校验；不能替代跨字段数学/授权校验 | B01；src/contracts；额外字段拒绝、union分支、JSON修复失败 |
| WiseLibs/better-sqlite3 | 默认SQLite驱动候选；E0 | 参数化查询、事务、WAL；不建立ORM平台 | A01；src/shared/db；目标Node版本安装、事务回滚、唯一索引、备份恢复；安装不通先调整受支持Node版本，不自动换成内存库 |
| lovell/sharp | 图片解码候选；E0 | MIME/尺寸/真实解码与私有安全副本 | A03；src/features/media；伪后缀、压缩炸弹、EXIF、20MP/8MB边界 |
| vitest-dev/vitest | 选用；E0 | 单元/契约/故障测试 | A01基础配置，A/B各自测试；fixture deterministic provider |
| microsoft/playwright | 选用；E0 | 单体Web E2E、浏览器负载审查、无障碍与刷新 | A01配置；tests/e2e；真实持久化非只测组件截图 |
| langchain-ai/langgraphjs | 候选暂不作为基线依赖；E0 | 若以后采用，只替换WorkflowRunner适配器；Agent本身不依赖该库 | B01记录ADR；必须先验证持久恢复、取消、幂等和调用预算，不能仅因为叫多Agent就安装 |
| SenmuuuuW/universal-diagnostic-tutor-skill | E1，MIT；设计参考 | 借鉴竞争假设/诊断流程，重写高中数学专用提示和测试；不是可直接部署的教学系统 | B04；prompts/diagnosis.md；同错不同因、反证修订、虚构证据ID负例 |
| RunzheYang/SocraticAI | E1，提示/分角色思想参考 | 不直接fork其Web/运行栈；不能继承不存在的曝光和独立检验能力 | B01 ADR记录，不引入生产依赖 |
| breezedeus/Pix2Text | E1；备用而非默认服务 | 全中文手写需专项数据实测，代码与所有模型权重分别检查 | A03；默认复用已选多模态模型做忠实转写；需要离线OCR再提变更，不暗加Python服务 |
| alephpi/Texo、Texo-web | E1，归档许可AGPLv3 | 不默认复制进闭源Web；单公式OCR不能等同整页手写 | 不在10天关键路径；需要时做许可/设备/模型加载专项评估 |
| VikParuchuri/texify | E1存在快照；不采纳默认依赖 | 权重/代码条款和部署适配未完成，不作可直接商用结论 | 不阻塞默认多模态转写 |
| sympy/sympy | E1，归档BSD-3-Clause | 不直接eval学生文本，不开额外服务；必要计算用受限自有函数/人工核对 | B02；数值检查只能作反例搜索，不能当证明 |
| JudgePeach/math-question-bank等公开题库 | 仅结构参考 | 比赛必须使用主办方授权题库；代码许可不代表题目/图片授权 | A02；不能用网上抓来的固定题冒充完整比赛题库 |

## 3. D1/D2准入步骤（给开发AI执行）

1. A01读取已有package文件；若应用目录非空，先报告现有结构，不覆盖重建。选择相互兼容且仍受支持的Node/框架版本，查官方文档，不运行盲目的latest升级。
2. npm安装只在qisi-web内执行；生成并提交package-lock.json、Node版本文件。安装超时/无法联网记录blocked_external，保持功能规格，不伪造package-lock。
3. 记录每个直接依赖精确版本、解析地址、仓库、许可文件、传递依赖审查结果；保存npm ls、npm audit输出。发现漏洞需判断可达性并处置，不将没有audit输出记为零漏洞。
4. 运行最小烟测：npm run build；SQLite磁盘写后重启读取；公式安全渲染；Playwright启动目标浏览器；sharp解码。结果放artifacts/reuse/，哈希引用到reuse-lock.json。
5. E1素材若复制代码/文本，保留版权和许可声明。只借鉴思路也标注来源，不抄整套未经核验的提示词声称自主研发。
6. 复用失败的替换：先写changes记录，说明能力等价测试和依赖影响，由A/B确认写集；允许替换基础库，不允许以此删手写、守卫、持久化或评估。

## 4. 证据包

本包evidence包含已用到的原始README/许可节选文件原样副本、源审计和SHA256索引；大体积HTML不重复打包。仓库链接只是溯源，不表示本轮重新打开成功。

官方入口（开发时再核验）：

- https://github.com/vercel/next.js
- https://github.com/remarkjs/react-markdown
- https://github.com/remarkjs/remark-math
- https://github.com/KaTeX/KaTeX
- https://github.com/colinhacks/zod
- https://github.com/WiseLibs/better-sqlite3
- https://github.com/lovell/sharp
- https://github.com/vitest-dev/vitest
- https://github.com/microsoft/playwright
- https://github.com/langchain-ai/langgraphjs

## 5. reuse-lock.json要求

初始文件只记录planned，resolved_version=null；这不是可供npm ci使用的锁文件。A01/D2完成后每项必须有实际版本和证据，才允许转accepted；deferred组件不影响Web基线。开源许可/软件更新状态需要到实施环境重新确认，不由本文给出法律保证。
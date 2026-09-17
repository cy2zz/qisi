# ADR-001｜确定 React、NestJS、MySQL 8.4 与受控多 Agent

状态：用户已确认；依赖尚未完成安装和运行兼容性验证。原始日期：2026-09-16；技术栈修订：2026-09-16。实施基线：qisi-3.1。

本修订替代此前的根目录全栈框架方案，保留 qisi-3.1 全部产品 P0、MySQL 8.4 和有界多 Agent 要求。

## 1. 唯一选型

| 层 | 决定 | 边界 |
| --- | --- | --- |
| 运行时/语言 | Node.js 24 LTS、TypeScript | 浏览器与服务端同语言；mysql2/sharp 只在 server 运行 |
| 前端 | `web/`：React 19 + Vite + React Router | PC 优先、完整适配 H5 的响应式 SPA；不含模型密钥、数据库或私有题解 |
| 后端 | `server/`：NestJS | REST 提交命令，SSE 发送状态和校验后内容；API 与 worker 使用同一代码库 |
| UI | Tailwind CSS、shadcn/ui | 组件源码归项目，依赖同样做许可与安全检查 |
| 多 Agent | NestJS 领域服务 + 可选 LangGraph.js StateGraph | 显式有界图；不做自由群聊；MySQL 领域状态是事实来源 |
| 模型 I/O | AI SDK Core 或 provider SDK，经 ModelPort/ModelGateway | 不启用第二套自动 Agent 循环；provider 由真实能力探测选择 |
| 数据 | MySQL Community Server 8.4 LTS、mysql2、Kysely | InnoDB/utf8mb4；显式 SQL 迁移和短事务，不让 query builder 隐藏锁语义 |
| 数据验证 | Zod + 已有 JSON Schema | 严格字段和跨字段 PolicyGate；前后端共享契约或生成客户端类型 |
| 数学渲染 | react-markdown、remark-math、rehype-katex、KaTeX | 不启用不受信任 raw HTML；公式失败保留原文 |
| 图片 | sharp + 多模态模型转写 | 真实解码、逐行不确定性、学生确认；不新增 Python OCR 服务 |
| 测试 | Vitest、Supertest、Playwright、真实 MySQL 8.4 集成测试 | fixture 不替代数据库、真实模型和人工教学评估 |
| 部署 | React 静态站点 + NestJS API/worker + MySQL + 私有媒体存储 | 同域反向代理 `/api`；数据库不公网暴露 |

版本策略：主版本已选定，精确 patch、镜像 digest 和 peer 兼容由 A01 实际安装后锁定。禁止使用 `latest` 或编造 lock。若发现目标主版本不兼容，提交 ADR 修订，不擅自降级或更换数据库。

## 2. 为什么这样选

产品是面向高三学生的状态型 AI 教学应用，核心复杂度在长任务、权限、工作流恢复和教学证据，不需要 SSR、SEO 或服务端组件。React/Vite 保持前端轻量；NestJS 提供明确的 Controller、Guard、领域服务、worker 和依赖注入边界；TypeScript 单语言避免十天开发期引入 Python API 契约和双套部署。

MySQL 8.4 是明确选择。由于 JavaScript 生态不能假定存在已经通过本项目要求的官方 MySQL checkpoint saver，业务恢复首先由领域表承担，不把自研完整 saver 设为 D1 前置。

## 3. 目录与迁移顺序

目标目录固定为：

- `web/`：React 页面、组件、前端状态、浏览器测试。
- `server/`：NestJS API、worker、领域逻辑、模型、工作流、数据库、迁移和后端测试。
- `qisi-sdd-v3/`：规格。

当前未提交工作区已经出现旧 `frontend/`、`backend/` 删除和 `web/`、`server/` 新目录；它们属于迁移中的用户改动，不得回退或覆盖，也不能仅因目录存在而标记完成。

1. 盘点 `web/`、`server/` 当前文件、旧页面行为和题库样本，保存可复用数据与测试。
2. 将 `web/` 初始化为 React 19 + TypeScript + Vite；将 `server/` 初始化为 NestJS + TypeScript。
3. A 统一管理依赖、容器、Kysely/mysql2 门面和全部迁移；B 在自己的 model/workflows/agents/contracts 写集实现。
4. 打通页面 → NestJS API → worker/受控工作流 → PolicyGate → MySQL → 刷新和进程重启恢复。
5. 旧骨架删除属于单独迁移事实；提交前检查 Git diff，不把 build 产物、node_modules 或 target 带入版本库。

## 4. MySQL 与工作流恢复决定

MySQL 中的 requests、workflow_runs、workflow_steps、model_calls、jobs、events 与领域表是恢复和审计事实。worker 通过 lease、fencing token、版本/CAS 和幂等键领取及提交工作：

1. 短事务领取任务并持久化节点开始状态。
2. 事务外调用模型；每次尝试计入预算。
3. 严格校验候选输出。
4. 重新检查 owner、lease、fencing、版本、期限和取消状态。
5. 短事务提交节点结果、领域状态和对外事件。

进程崩溃后从持久阶段重新进入有界图。若后续实现 LangGraph `BaseCheckpointSaver` 薄适配，它只能保存执行快照，必须经过 put/get/list/pending writes、取消、删除、重启和故障窗口 conformance；不能形成第二套业务真相，也不能替代最终领域事务。

## 5. 职责与门禁

- A：根配置/容器/CI、`web/` 公共 UI、`server/` 数据库门面和迁移、题库、媒体、输入、Assessment、报告、历史和部署。
- B：`server/` contracts/model/workflows/Preparation/Diagnosis/Strategy/Renderer/Guard，`web/` 教学和教师页面。
- AssessmentAgent 业务实现归 A。
- A01/B01 先冻结 REST DTO、错误结构、StorePort、ModelPort、StudentView、任务租约和目录归属。
- 首个共同门禁是 React 页面经 NestJS/worker 写入真实 MySQL 并在刷新与 Node 进程重启后恢复；不是只跑内存图。

## 6. 不引入

首版不加 Redis、消息队列、向量库、通用 RAG 平台、GraphQL、CQRS、微服务拆分、Python/FastAPI OCR 或解题服务。API 与 worker 可以是两个进程，但使用同一个 NestJS 后端代码库和同一个 MySQL 事实来源。

## 7. 参考与证据边界

候选参考入口：React、Vite、NestJS、Node.js、LangGraph.js、AI SDK Core、Kysely、mysql2 与 MySQL 8.4 官方资料，URL 见 reuse.md。参考入口不是兼容性证明；所有运行、许可、漏洞和恢复证据由 A01/B01 实际产生。

# ADR-001｜确定技术栈与受控多Agent

状态：用户已确认；依赖未安装，运行兼容性待A01/B01实测。日期：2026-09-16。实施基线：qisi-3.1。
替代qisi-3.0中“原生TS编排+SQLite，LangGraph仅候选”的决定；不删任何P0功能。

## 1. 唯一选型

| 层 | 决定 | 边界 |
| --- | --- | --- |
| 运行时/语言 | Node.js 24 LTS、TypeScript | 全部服务端采用Node runtime，不用Edge runtime访问mysql2/sharp |
| Web | Next.js 16 App Router、React 19 | 同仓页面、Route Handlers/Server Actions；一个业务服务 |
| UI | Tailwind CSS、shadcn/ui | 组件源码归项目，生成依赖同样做许可/安全检查；A拥有公共UI |
| 多Agent | LangGraph.js Graph API / StateGraph | 显式有界图；非自由群聊，不需要LangGraph托管平台 |
| 模型I/O | AI SDK Core经ModelPort | 不用AI SDK Agent自动循环；provider由实际比赛凭据与能力探测决定 |
| 数据 | MySQL Community Server 8.4 LTS、mysql2 promise API | InnoDB/utf8mb4；显式SQL迁移和事务，不引入ORM |
| 数据验证 | Zod + 已有JSON Schema | 两者生成/验证保持一致；严格字段和跨字段PolicyGate |
| 数学渲染 | react-markdown、remark-math、rehype-katex、KaTeX | 不启用不受信任raw HTML；公式失败保留原文 |
| 图片 | sharp + 多模态模型转写 | 真实解码、逐行不确定性、学生确认；不加Python OCR服务 |
| 测试 | Vitest、Playwright、真实MySQL 8.4集成测试 | 内存fixture可测逻辑，不能替代数据库和真实模型验收 |
| 部署 | Docker：单Node应用 + MySQL + 私有媒体卷 | 数据库容器不是独立业务后端；数据库端口不公网暴露 |

版本策略：以上主版本/分支已确定；精确patch、镜像digest、peer依赖兼容由A01实际安装后锁定。不要使用latest、编造package-lock或把reuse-lock.json当安装锁。保留mysql2驱动与LangGraph/checkpoint版本的升级回归。若发现目标分支不安全或不兼容，提交ADR修订，不擅自换栈。

## 2. 为什么这样选

两人约十天按纵向切片开发，减少两套业务语言与接口同步；框架复用不取代教学判断。MySQL为用户明确指定，服务业务数据与checkpoint；不做“开发SQLite/上线MySQL”。LangGraph复用图执行/分支/持久恢复接口，避免造通用编排器；模型接入与编排只保留各一层。

保持：Preparation、Diagnosis、Strategy、Assessment四专职Agent，另有Renderer/Guard；独立上下文/Schema/提示/回归。教师页展示可审计教学依据而不是隐藏CoT。模型不能执行SQL或直接写学生状态。不得把Agent数、图运行成功或原题完成当学习效果。

## 3. 仓库现实与迁移顺序（A01主责）

当前frontend/是React/Vite骨架，backend/是Java17/Spring Boot/MyBatis/H2骨架；本次只改规格，没有迁移应用。唯一目标仍为qisi-dashboard仓库根，源码src/、规格qisi-sdd-v3/，不另建同级或嵌套应用。

1. 先盘点现有页面、题库样本与服务行为，记录可复用数据/测试；不清空目录。
2. 在仓库根建立目标Next.js配置、src/和测试工具，移植必要页面行为与题库数据，不把旧Java业务依赖当成目标运行条件。
3. A统一安装依赖、迁移与容器配置；B只在自己的src/model、src/workflows、Agent和契约写集实现。
4. 根应用跑通题目读取、一次受控图调用、安全输出、MySQL写入与刷新/重启恢复。旧frontend/backend可保留但不进入新应用启动/build。
5. 本轮不删除旧骨架；后续清理需单独记录变更，保留Git回滚路径，不假设H2里没有用户数据。

## 4. MySQL/LangGraph适配决定

采用项目自有MySqlCheckpointSaver薄适配器，实现所锁LangGraph BaseCheckpointSaver协议；B写src/workflows/persistence/**，A写migrations/**及src/shared/db/**。理由：不能把未经测试的社区MySQL saver假定为已可用。可以复用官方checkpoint接口与序列化器，不自行设计第二个图执行框架。

A01/B01的准入门禁是前置，不拖到D7才首次验证。B在D1先完成最小saver conformance，D2前覆盖真实MySQL恢复；D7进行完整故障加固。适配超出预计一天时，明确延期和风险，不能偷偷使用MemorySaver/SQLite上线。若发现高质量社区适配器，先做许可证、维护、目标版本、取消/删除/恢复测试，提交ADR变更再替换。

LangGraph checkpoint是私有执行快照；node_runs是节点调用/成本审计；events/requests/sessions是业务事实。三者职责不可混淆。详细一致性协议见contracts/workflow-persistence.md。

## 5. 双人职责与阶段门禁

- A：根package/lock/config、shadcn公共UI、mysql2连接池、全部SQL迁移（含checkpoint表）、StorePort、匿名归属、部署与备份。不得独立写第二套ModelPort。
- B：ModelPort接口与AI SDK适配、LangGraph图、MySQL saver、预算器、Preparation/Diagnosis/Strategy、Renderer/Guard和教学/教师页面。不得直接修改A的package和迁移；给A交接补丁。
- AssessmentAgent归A，B的agents全局写集排除该子目录；D1仅协商空接口。
- A01/B01先协商类型与数据库连接门面，可并行搭骨架；两张卡的共同集成门禁通过前不得标done。不是彼此依赖整张卡形成死锁。
- ST01–ST12见acceptance/stack-cases.json；原AT01–AT60及所有教学质量门禁保留。

## 6. 不引入

不加Redis、消息队列、向量库、通用RAG平台、Python/FastAPI OCR或解题服务；不做自由Agent群聊、双重Agent自动循环、未经校验的token直流。首版仅一个应用恢复进程，不宣称已有分布式执行能力。

## 7. 参考与证据边界

官方参考入口：Next.js文档、Node发行计划、LangGraph.js Graph API/Persistence与checkpoint源码、AI SDK Core、mysql2官方文档、MySQL 8.4手册。URL在reuse.md。参考入口不是兼容性证明；本轮未成功取得可归档的在线正文，不宣称完成依赖安全核验。所有运行/许可/漏洞证据由A01/B01实际产生。

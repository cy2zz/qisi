# qisi-dashboard｜启思 AI 高三数学思维老师

## 当前决定与实现状态

当前产品规格基线为 **qisi-3.1，2026-09-16**。产品面向高三学生，重点是高考数学中的卡点诊断、最小必要提示、限时训练、错题复测与可核验的学习证据。

当前用户确认的目标技术栈为：

- 前端：`web/`，React 19 + TypeScript + Vite，Tailwind CSS + shadcn/ui。
- 后端：`server/`，NestJS + TypeScript，Node.js 24 LTS。
- 数据库：MySQL 8.4 LTS + mysql2，InnoDB、utf8mb4、显式 SQL 迁移。
- 数据访问：优先采用 Kysely 保留类型安全；复杂事务、锁和迁移允许显式 SQL。
- AI 工作流：NestJS 内的有界工作流；需要图编排时使用 LangGraph.js，MySQL 领域状态始终是业务事实来源。
- 模型接入：经项目 `ModelPort` / `ModelGateway` 统一接入，真实 provider 由凭据、中文数学、视觉、结构化输出和延迟实测决定。
- 数据与显示：Zod、react-markdown、remark-math、rehype-katex / KaTeX、sharp。
- 验证：Vitest、NestJS/Supertest、Playwright、真实 MySQL 8.4 集成测试。
- 部署：React 静态站点 + NestJS API/worker + MySQL 8.4；同域反向代理 `/api`，默认不向浏览器流式发送未校验的模型内容。

这项决定替代此前“根目录全栈单体应用”的技术方案。`qisi-sdd-v3/` 的活动规格、任务写集和应用边界已同步为 `web/` + `server/`；`publication/`、manifest、历史 ZIP 和旧变更记录仍作为发布凭证保留，不能当作当前实施指令。产品需求、教学红线和验收目标继续适用，精确依赖与可执行命令仍须由 A01/B01 依据实际初始化结果锁定。

当前工作区正在进行目录迁移：旧 `frontend/`、`backend/` 在未提交改动中被移除，`web/`、`server/` 已出现，但目录存在不代表 React/NestJS 目标栈已经初始化、测试或验收完成。不要覆盖、回退或把这批现有改动冒充为本次文档变更。

## 目录约定

- `web/`：React 前端。只包含浏览器代码、页面、组件和前端测试；不得包含模型密钥、数据库连接、私有题解或教师私有数据。
- `server/`：NestJS 后端和 worker。包含 API、工作流、模型适配、数据库访问、迁移、媒体处理与后端测试。
- `qisi-sdd-v3/`：当前 qisi-3.1 产品规格包；活动来源已同步为 React/Vite、NestJS 和 MySQL 8.4，历史发布/生成物另行保留。
- `ravenspec/`：规格变更记录。现有 MySQL/LangGraph 冻结记录不等于 NestJS/React 迁移已经完成。
- `research-evidence/`：原始方案、调研与来源快照。
- `qisi-sdd-v3.zip`：历史规格附件，不是应用安装包；未经授权不重打包。

## 前后端边界

- `web/` 通过 REST 提交命令，通过 SSE 接收运行状态和已经校验的最终内容；移动网络不稳定时应支持安全轮询回退。
- `server/` 负责身份、权限、题库、媒体、模型调用、工作流、PolicyGate、幂等和最终事务提交。
- 长耗时备课、转写、诊断和评估由独立 worker 执行，不把长模型调用绑定在浏览器请求生命周期内。
- MySQL 业务表、工作流步骤、任务租约、模型调用和事件审计共同支持恢复。LangGraph checkpoint 只是执行细节，不是业务提交、帮助曝光或学生学会的证据。
- 在没有经过真实一致性测试前，不假定存在可直接采用的官方 LangGraph.js MySQL checkpoint saver，也不以 MemorySaver、SQLite 或 mock 冒充 MySQL 恢复能力。

## 面向高三学生的产品优先级

1. 正确率、评分点和可核验依据优先于 Agent 数量或视觉效果。
2. 手机单栏、拍照输入、公式快捷输入和断网草稿优先于桌面三栏布局。
3. 学生应能选择“最小提示”或“直接讲清楚”；不强制冗长追问。
4. 常用题目的题干、标准解、易错点和评分点应预处理并核验，降低在线等待时间。
5. 所有诊断区分概念、思路、计算、条件遗漏和表达问题；合法异解不能因不同于参考路线而判错。
6. 高三学生多为未成年人，默认最小化收集和保存身份、聊天与手写图片。

## 开发入口

开始开发前先读根 `AGENTS.md`。`qisi-sdd-v3/tasks.json` 的产品目标、验收编号和写集已映射到 `web/` / `server/`；任务中的命令是验收意图，只有在 A01/B01 建立并实际运行对应脚本后才能报告通过。

精确依赖版本、Node patch、MySQL 镜像 digest 和 provider adapter 必须在实际安装与测试后锁定。当前目录或依赖文件存在不等于新栈已经通过准入。

### 本地环境

本地应用使用 Node.js 24.14.0，MySQL 使用根 `compose.yaml` 中的 8.4 版本线。`.env`、`web/.env.development.local` 和 `server/.env.development.local` 只保存在本机且被 Git 忽略。

```text
npm install
docker compose up -d mysql
npm --prefix server run db:migrate:dev
npm run start
```

前端默认位于 `http://localhost:5173`，并将 `/api` 代理到 `http://localhost:3000`。数据库不可用时 `/api/health` 仍表示进程存活，`/api/health/ready` 返回数据库就绪状态。

### 正式环境

正式环境通过运行时环境变量连接外部 MySQL 8.4，不把凭据写入镜像或已跟踪文件。当前机器的 `server/.env.production.local` 已配置指定 RDS，文件受 Git 忽略；正式部署前仍必须确认数据库名、网络白名单、TLS 证书与站点域名，并替换 `WEB_ORIGIN`。

```text
docker compose --env-file .env -f compose.production.yaml build
docker compose --env-file .env -f compose.production.yaml run --rm api node dist/database/migrate.js
npm run start:prod
```

生产迁移会先拒绝非 MySQL 8.4.x 实例。未经数据库所有者确认，不应在正式 RDS 上运行迁移、fixture 或清理命令。

## 规格验证与发布状态

现有规格检查可验证 qisi-3.1 活动来源内部一致性，但静态检查通过不等于 NestJS/React/MySQL 应用已经初始化或验收通过。

qisi-3.1 尚未重新发布到 POPO。历史发布、ZIP 和回读记录继续保留，不因本次技术方向调整而覆盖。主办方题库、模型凭据、MySQL 8.4 测试环境和部署环境仍需实际提供与验证。

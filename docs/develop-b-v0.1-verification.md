# develop-B-v0.1 合并后的界面验证说明

日期：2026-09-20；基线：qisi-3.1。本文是操作清单，不是全量验收通过证明。

## 1. 本次版本与工作区

- B 实现提交：`1ce544b`，分支 `develop-B-v0.1`（按用户指定创建；原 `develop-B-v1.0` 保留）。
- 合并基线：fetch 后的 `origin/develop` = `efb10a3`，包含 A 最新学习流程、动态路线、草稿和 UI 改进。
- develop 验证工作区：`D:\math\qisi-dashboard-develop-merge`。它与 `D:\math\qisi-dashboard` 共用 Git 仓库，后者仍检出 B 分支。
- `D:\math\develop\qisi-dashboard` 是另一个 clone；其中未提交的 README 不在本次修改范围，不应以这个旧目录的运行结果验证新合并。
- 本次只提交/本地合并，不 push、不发布、不部署。B01–B10 仍是 in_progress，不能因为合并而改为 done。
- 未提交旧 Raven 初始化/本地配置、技能链接工具、无关文档和 tsbuildinfo；未新增密钥、修改 DDL、迁移/清空业务库。

## 2. 启动前确认

1. 在 develop 验证目录执行 `git branch --show-current` 和 `git log -1 --oneline`，应为本次合并后的 develop。
2. Node 版本应为项目锁定的 24.21.0。当前机器的验证 worktree 临时复用了同锁文件的已安装 node_modules（junction），不是一次独立 npm ci 验收；新机器应按仓库锁文件安装依赖。
3. 后端实际配置由当前启动目录的 `server/.env.development.local` 等文件和进程环境提供。核对 `DB_*` 指向获授权的开发/测试库，`AI_API_KEY / AI_BASE_URL / AI_MODEL` 已正确设置。不要把 key 放进 web、截图或日志。
4. 页面联调必须有真实可用的用户/会话等表与题库。所有 DDL 在 `server/db/`；缺表时由数据库负责人对明确授权的目标库执行迁移，不要为试页面直接对业务库执行 fixture、清空或 live verifier 的清理语句。8.0 联调与 8.4 正式验收分开记录。
5. 确认 3000/5173 没有运行其他分支的旧服务。不要直接结束他人的进程；由启动者停止，或另行协调端口并同步 WEB_ORIGIN/代理。

PowerShell：

```powershell
Set-Location D:\math\qisi-dashboard-develop-merge
npm start
```

浏览器打开 `http://localhost:5173`。默认 WEB_ORIGIN 与这个地址对齐；不要随意混用 localhost 和 127.0.0.1。

## 3. 主页面手工验收（使用专用测试账号/数据）

| 步骤 | 界面操作 | 观察/通过条件 |
| --- | --- | --- |
| 登录 | 输入专用测试用户名，进入学习页 | 登录后落在 `/study`；无白屏或循环登录 |
| 题库准备 | 从题库选择实际题目，或在题库范围点“随机抽一道”，核对题面再选择 | 显示题目来源/题面；失败不暗换题；待核对、准备失败等限制可见。只手输自拟题不证明真实题库 Preparation 验收 |
| 自主作答 | 在“输入题目或想法”输入自己的方法/第一步，点“发送” | 先允许自己尝试；未求助不提前展示完整解法；反馈围绕当前证据，不把表述不清直接当概念错误 |
| 最小提示 | 点“给一点提示”（窄屏可显示“提示一点”） | 给有限的下一步帮助，不直接代做整题；显示相应帮助深度 |
| 直接讲解 | 点“直接讲清楚”，确认“继续直接讲解” | 确认前不发出讲解；确认后按更深帮助处理；刷新不把已曝光帮助洗成独立 |
| 合法异解 | 提交不同于参考路线、但数学上成立的方法，并解释依据 | 不因路线不同直接判错；若路线已核验，显示“沿你的路线”或“共同补全”；证据不足应保持未知。不能用某一道 fixture 的结果替代数学人工核对 |
| 手写 | 点“添加手写作答”→选图→“识别手写作答” | 先显示逐行转写；修改误识别，对“待确认”行逐一确认；再点“确认转写并放入输入框”，最后自行发送；确认转写不代表答案正确 |
| 草稿/刷新 | 写未发送的多行推导，等待保存后刷新；在测试会话模拟断网后编辑，再恢复网络 | 草稿可恢复、未同步状态可见；不能凭草稿恢复宣称后端 worker 崩溃恢复通过 |
| 本题核对 | 提交自己的结论，通过页面“核对这次答案/核对结论”流程 | incorrect/unknown 不可进入独立通过；correct 也只代表原题结论，不能直接写“已掌握” |
| 独立检验 | 原题核对有依据后，点“换一道题独立检验” | 若无合格新任务应明确阻塞。能进入时先写计划→“锁定计划，开始作答”→独立作答→“提交最终答案”；提交前不暗示对错，首次计划/最终答案冻结 |
| 检验中求助 | 在另一条专用测试会话点“我需要帮助”并确认 | 从独立转为带帮助；不能撤回求助后继续宣称独立通过 |
| 历史/报告 | 打开历史记录，使用“查看原题记录”“查看证据报告” | 与实际帮助、首次计划、执行和 unknown 边界一致；刷新保留记录 |
| 删除 | 只对可丢弃的测试会话点“删除记录”并确认 | 清晰二次确认；删除后不能从旧链接/迟到响应恢复该会话。不要删除他人或真实学生记录 |
| H5 | 浏览器设备模式选择 390/360 宽，重复输入、手写、核对和检验 | 核心操作可达，公式可读、编辑/提交不被软键盘区域遮挡；真手机键盘仍需实机测试 |

只做快速联通冒烟，可手输自拟题“化简 $\frac{\sqrt{2}}{\sqrt{3}}$”，再提交自己的第一步。它不代表高考题库或完整独立检验已经通过。

## 4. 不能混淆的两条教学链路

- `/study` → `/api/problems/analyze`、`/api/problems/chat`：A 主学习入口，有 Preparation / Diagnosis / Strategy / Renderer / Guard 及 Assessment 相关服务接线。
- `/learn/:sessionId` → `/api/tutor/turn`：B 有界教学轮已接 A 的 MySQL 事务门面，但页面初始化仍请求未提供的 `GET /api/session/:id`；A 的 `GET /api/learning/sessions/:id` 返回另一种 DTO。不能直接换 URL 冒充接通。
- B 页面遇到上述缺口显示错误说明而不白屏，是降级边界测试，不是完整教学链路通过。
- `/teacher` 尚无完整 App/持久授权接线；不要当作已可用教师页面。
- B 的动态路线/finish_problem 到 Assessment 转场、worker claim/fencing/崩溃恢复和所有失败调用的持久预算恢复仍未完整接通。A 主入口的局部路线成功不覆盖这些缺口。

## 5. 怎样确认真模型与多个角色

1. 当前四个业务 Agent 加 Renderer/Guard 共用服务端同一组 AI 配置；手写转写也走同一个模型端口。普通教学通常 Diagnosis → Strategy → Renderer → Guard；Preparation/Assessment 在各自阶段执行，不是每轮六个都调用。
2. 浏览器 Network 中看实际 POST、HTTP 状态和安全返回；浏览器不应看到 API key、私有参考答案或原始内部诊断。
3. `/study` 的请求不是 B `/tutor/turn`；现有 `test:tutor-live` 也测 `/problems/chat`。记录清楚入口。
4. 要证明角色实际调用，应通过受控的服务端节点审计/模型调用记录核对 role、model、prompt version、usage、request_id；不要只凭界面“正在诊断”文案判断。
5. 浏览器 fixture 测试会拦截 API，没有真实模型/数据库；真实 key 权限、视觉能力、真实数学质量、费用、人工教学评估必须另验。

## 6. 合并冲突与证据

- 4 份 B03/B05 change/handoff 文档同时保留两边来源快照，当前状态在页首单独说明。
- LearningSessionService 合并同时保留 A 的 route_patch_approved 与 B 的 checked_teaching_turn 两种私有事件、各自安全响应，以及 B 的 session/lease/revision 检查。
- 新增 A 路线事务测试夹具补齐真实表本来就有的 session.expires_at / run.session_id；不改测试期望、不放宽生产校验。
- 命令、退出码和当前测试数量见 `artifacts/acceptance/B-20260920-merge/`。首次并行 worker 超时、未补齐夹具失败和 Windows 证书路径断言失败均保留，不覆盖成通过。
- 原始历史日志保留原始换行/末尾空行；全量 diff --check 会因此报格式问题。源码/规格/脚本/文档范围另行检查，不能以日志格式清理覆盖历史证据。
- 本轮 self_review，无独立复核；合并不代表 AT/ST 全量通过或可以生产发布。

## 7. 本次合并工作区实际回归（2026-09-20）

所有命令从本节所述 develop worktree 执行，使用 Node 24.21.0。测试使用 fixture/mock，未启动真实模型、MySQL 8.4 或浏览器；不是全量 AT/ST 验收。

| 命令 | 退出码 | 实际结果 |
| --- | --- | --- |
| `npm --prefix server run typecheck` / `lint` / `build` | 各 0 | 通过（静态检查/构建，无测试数量） |
| `npm --prefix web run typecheck` / `lint` / `build` | 各 0 | 通过（静态检查/构建，无测试数量） |
| `npm --prefix server test -- --maxWorkers=2` | 1 | 606 项：591 passed、1 failed、14 skipped；73 文件 |
| `npm --prefix web test -- --maxWorkers=1` | 0 | 126 passed；25 文件 |

后端剩余失败：`server/src/database/database.factory.spec.ts:36` 的证书路径断言只接受 `/`，Windows 实际路径使用 `\`。该测试不在本轮合并冲突范围内，未改测试期望或生产逻辑。14 项 skipped 不计作通过。

保留的先前结果：
- 首轮同时运行两端回归：server 589 passed / 3 failed / 14 skipped；web 54 passed，同时有 7 个 worker 启动错误，未完整执行全部文件。
- server 首轮中的 route patch 测试缺失运行会话字段，按真实契约补齐夹具后通过；teacher HTTP 的 hook 超时在降低并发后未再出现，未放宽超时。
- web 的 `--maxWorkers=2` 仍有 cookie 恢复等待测试失败（125 passed / 1 failed）；不修改代码、断言或超时，随后 `--maxWorkers=1` 全部通过。低并发通过不抹除前次失败，也不视为已根治时序敏感性。

完整命令、原始日志、失败分类与未执行范围见 `artifacts/acceptance/B-20260920-merge/merge-review.json` 及同目录日志。源码/规格/文档范围 `git diff --cached --check` 通过；原始历史日志的换行告警单独保留。

后续全量验收前仍需：补齐 B 页面读取 DTO、教师授权接线、独立检验转场、worker/fencing/持久预算恢复，再安排真实 MySQL 8.4、真模型、浏览器端到端与人工数学/教学评估及独立复核。本次没有执行 Raven 发布门禁、POPO 同步或部署。

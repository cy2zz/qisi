# Raven SDD 接入

本仓库按提供的《Raven SDD如何接入和使用》接入 **bigdata-sdd-workflow**，目标 Agent 为 **Codex**。这是开发工作流，不是应用运行时 SDK。

## 已执行的接入（2026-09-16）

- Node.js v24.15.0 / npm 11.12.1；Raven CLI 从 0.30.2 升级到内网源当时返回的 0.35.12。
- 复用本机有效 Raven 登录，不把凭证复制到仓库。
- 执行 Codex 初始化，并显式执行 workflow use，使完整快照落盘。
- 工作流校验：configName = bigdata-sdd-workflow、hasLocalChanges = false、hasPendingMerge = false。
- KnowVault availability = enabled；know-compiled 已同步，实际本地检索命中 EasyData 目录索引。
- 按账号部门信息在用户目录 ~/.raven/knowvault/self.yaml 配置 dept: EasyData技术部；group 未知，未猜测。
- 保留 Raven 生成的 skills 及辅助设施，另外将 skills 映射到 .agents/skills，供 Codex 使用；目录链接是机器本地状态。
- 未修改 frontend/、backend/、qisi-sdd-v3/ 或已发布 ZIP，也没有创建业务 Change、提交、推送或发布文档。

## 新机器初始化（仓库根目录，PowerShell）

需要 Node.js ≥ 18、npm、公司网络、Raven 登录与知识仓库访问权限。

~~~powershell
# 固定为本次验证版本；一次性指定内网源，不更改全局 npm registry
npm install -g @music/raven-cli@0.35.12 --registry https://rnpm.hz.netease.com/
raven --version
raven whoami
# 仅在未登录时执行 raven login

# 0.35.12 在干净 Codex 项目中可能先读取 Claude settings，预建空文件规避 ENOENT。
# 绝不覆盖已有 settings。
New-Item -ItemType Directory -Force .claude | Out-Null
if (-not (Test-Path .claude/settings.json)) {
  [IO.File]::WriteAllText((Join-Path $PWD '.claude/settings.json'), '{}')
}

# --yes 会清理反选 Agent 的配置；已有其他 Agent 定制时先检查并备份，改用交互初始化。
raven init -a codex --workflow-config bigdata-sdd-workflow --yes
# 不仅依赖 init 的成功文案：显式拉取完整工作流并校验
raven workflow use bigdata-sdd-workflow
node scripts/link-raven-skills.mjs
raven workflow show --json
raven knowvault availability
raven knowvault repo status
~~~

skills 与 hooks 的生成目录已加入 .gitignore，避免提交用户主目录的绝对链接及整套 CLI 依赖。新机器必须重新初始化；脚本不会覆盖同名自定义 skill。更新 Raven 后重新运行链接脚本；配置变更后再次执行 workflow show 检查。

部门配置属于个人设置，不随仓库提交。以实际组织归属填写 dept/group，不要直接照抄其他人的小组。

## 项目文件

| 路径 | 用途 |
| --- | --- |
| .raven/workflow-config.json | 工作流名称绑定 |
| .raven/workflow-config-full.json | 团队工作流基线与本地快照 |
| ravenspec/config.yaml | 本项目技术栈、qisi-3.0 基线、验证与授权约束 |
| ravenspec/schemas/ | Raven 生成的流程 schema 与模板 |
| ravenspec/changes/、ravenspec/specs/ | 新变更与归档规格，独立于原发布包 |
| AGENTS.md | 仓库级开发约定及 Raven 入口 |
| scripts/link-raven-skills.mjs | 将 Raven skills 映射到 .agents/skills，保留共享引用且不覆盖现有技能 |
| .codex/skills/、.agents/skills/、.claude/ | 本机生成目录，不提交 Git |

## 开始使用

在此项目的新 Codex 会话中选择 sdd-new-change，或明确提出“使用 sdd-new-change，为……创建变更”。若技能列表未更新，重启/重新打开项目后检查；当前接入会话没有实际执行新业务变更。

正常流程为 PRD → specs → DESIGN → Plan Review → TASK → apply → verify → archive。不能把初始化成功或文件存在当作流程验收完成。技能要求子 Agent、自动 commit 或外部写操作时，仍以当前会话和 AGENTS.md 的授权约束为准。

Raven 同时生成 .claude/hooks 等辅助设施，但本次没有配置或验证 Codex 对这些 Claude hooks 的执行；不能宣称具有相同的自动门禁保障。

## 验证与已知事项

本次实际验证：路径适配测试 5/5 通过；重复链接结果 created=0、existing=116；10 个核心技能入口可读；项目 YAML 的 prd/specs/design/task 规则与 Raven schema 匹配；工作流同步状态及 KnowVault 本地检索通过；git diff --check 通过。

~~~powershell
node --test scripts/link-raven-skills.test.mjs
node scripts/link-raven-skills.mjs   # 可重复执行，第二次 created 应为 0
raven workflow show --json
raven knowvault availability
raven knowvault repo status
raven knowvault grep --pattern EasyData --max-matches 1
~~~

- **git-ai 内部版迁移未完成**：Raven 尝试将现有 1.7.4 替换为 1.2.8-ntes.9，报告权限不足；检查发现现有 git-ai.exe 正在运行 bg run 后台进程。本次未停止用户进程、未修改权限或强行替换。需要时在安全退出后台进程后另行执行 raven git-ai install，再用 raven git-ai status 验证。
- KnowVault doctor 提示 know-prime 未克隆、skill-packages 目录不存在。know-compiled 检索已验证；知识投稿、转换技能与 know-prime 写入不在本次接入范围，未自动上传任何文档。
- 未执行前后端构建或产品验收：本次只改开发工具配置；skills 路径适配有独立自动化测试。
- 原 README 保存了历史交付说明。当前代码实际在 frontend/ 和 backend/，不要据其历史绝对路径创建另一个应用目录。

## 参考

参考 POPO 文档（移除了客户端参数）：

~~~text
https://docs.popo.netease.com/team/pc/easydata_skills/pageDetail/9245221feb73425c823d9105a9c57eb6
~~~

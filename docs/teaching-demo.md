# 启思教学演示手册（B10 草案）

2026-09-20 / qisi-3.1 / **发布未就绪，未执行现场演示**。这是操作和取证计划，不是演示成功记录。B01–B03 有历史实现，不等于整张任务验收完成。

## 运行前门禁

1. 按根 AGENTS 核对 HEAD、dirty 工作区与 `artifacts/release/teaching/B-20260920-local/snapshot.json`。本次不提交、不推送、不部署；快照不是干净发布 tag。
2. A/B 对齐正式 AppModule/路由和统一 MySQL StorePort；当前新增 TeacherModule/TeacherPage 需要显式装配，不能假设访问 `/teacher` 已可用。严格 Diagnosis/Strategy `runChecked` 与遗留 `run` 是不同入口，未接入的生产路径不能算受新门禁保护。
3. 验证 qisi-3.1 运行配置、题库范围、实际 provider 能力、模型版本。只使用授权测试数据/账号；密钥不进入截图/命令输出。
4. 数据库只能为授权空 `qisi_spec_*` 测试库；目标 MySQL 8.4，8.0 结果单独标记。先阅读 mysql/workflow-persistence 契约和脚本保护，不复制本手册直接清库。
5. 当前通用回归命令：
   `npm --prefix server run typecheck` / `lint` / `test -- --reporter=dot` / `build`；
   `npm --prefix web run typecheck` / `lint` / `test -- --reporter=dot` / `build`。
   真实 DB/model 脚本先审核环境/目标和调用预算，不属于本次已执行命令。

## 四条现场分支（全部待执行）

| 分支 | 操作与观察 | 必须保留的证据 |
| --- | --- | --- |
| 手写与修订 | 现场随机选实际题库题；上传含歧义手写；先修订并确认再诊断；随后更正旧输入 | 来源/题目 hash、转写 uncertainty、confirmed revision、旧结论及后继失效、曝光未撤销 |
| 同错异教/异解 | 相同表面错误先保留未知，再分别给概念/执行证据；提交有效异解或已完成的关键步 | 引用/假设、可区分探针、不同干预、已核验路线 provenance、稳定目标两探针上限 |
| 撤架与独立检验 | 学生选择最小提示或直接讲解；发出帮助后进入新的未曝光任务；首次计划和答案锁定 | 实际曝光、首次冻结时间、独立/带帮助/原题重做区分、unknown，不展示未来 rubric |
| 故障与教师依据 | 网络重试/重启、超时/取消/删除后迟到；教师独立登录并确认曝光后打开依据 | 有效 lease/fencing、单次有效提交、恢复后的累计预算；先整题曝光提交再返回安全摘要 |

不得失败后暗换简单题。随机选题失败、准备失败、无可用检验、Guard unknown 都需原样展示。演示不等于学生学习实验。

## 教师模块接入清单（给 A）

- 实现 `TeacherStorePort` 的持久登录限流、会话 token hash 和授权表操作。
- `openTraceChecked` 在一个短事务中重查教师凭据有效性、会话 grant 或有效 owner、Origin、CAS、请求 hash/幂等、当前 task、取消/删除/TTL；写整题曝光+事件+回放响应后才能返回。
- `TeacherModule.register(store, options)` 的配置来自服务端；`TeacherPage({sessionId, initialVersion})` 的版本来自安全学生 DTO。UI 不能直接读 SessionState/Packet。
- 不增加第二套连接池/内存生产适配，不把教师 secret 放前端。重放不得再次计费曝光；未知提交结果应以同 request_id 重试。

## 演示声明模板

在画面显著标注 `live` / `fixture` / `recorded replay`；回放写原执行日期和版本，禁止称“现在实时”。本轮只有 fixture/规则测试，未新增 live 证据。展示真实节点审计/提示版本/总预算，不展示隐藏 CoT。未完成的门禁见模型卡和任务交接。

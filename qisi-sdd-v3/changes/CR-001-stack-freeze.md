# CR-001｜技术栈与LangGraph正式基线

日期2026-09-16；用户明确授权规格更新和develop推送。基线从qisi-3.0升为qisi-3.1；三正文版本为设计V6.1/规划V3.1/PRD V3.1。

- 固定MySQL8.4、Next16/React19/TS/Node24、Tailwind/shadcn、LangGraph.js Graph API、AI SDK Core和配套渲染/验证/测试；精确patch待实际安装锁定。
- 原16表DDL从SQLite语法改MySQL，新增schema_migrations与2张checkpoint表；SQL未执行，不声称兼容性通过。
- 保留全部FR01–FR18/AT01–AT60/20张任务；增加ST01–ST12及A01/B01/A07/B07/A10/B10归属。
- B的MySqlCheckpointSaver职责、A的迁移/事务门面、AI SDK不重叠编排、图checkpoint不等于业务提交均有明确契约。
- 根目录改为真实qisi-dashboard仓库，不另建应用；旧frontend/backend保留且本轮未修改。
- 旧在线发布证据不改，新包状态not_published；历史qisi-3.0包可从e54ec4a恢复。

验证：先新增stack校验得到预期失败，再修改规格；后续命令和实际结果见仓库ravenspec/changes/freeze-mysql84-langgraph-stack/verification.json。本包spec-validation.json仅规格检查；MySQL8.4/LangGraph/应用/真实模型/学生效果均尚未验收。报告不伪造依赖安装、自动Raven门禁或人工复核。

回滚：revert本次规格提交，不改变既有远端POPO及其他分支工作。

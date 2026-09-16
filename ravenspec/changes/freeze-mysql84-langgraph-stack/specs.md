# 可验证约束

- 系统规格MUST固定MySQL8.4 LTS及ADR-001其余技术栈；resolved_version在安装前MUST为空而非伪造。
- 三主文档和任务卡MUST保持同一基线与步骤；MUST保留18个P0、20张任务和60项产品AT。
- 多Agent编排MUST使用LangGraph.js Graph API；AI SDK Core SHALL仅经ModelPort处理模型I/O。
- MySQL checkpoint MUST与领域事务职责分开，取消/删除/过期后的晚到结果MUST拒绝。
- A SHALL拥有全局依赖与全部DDL；B SHALL拥有图与saver；Assessment业务归A。
- 当前本地修订MUST标not_published；旧POPO成功证据MUST保持原字节不变。
- 规格检查通过MUST NOT声明应用、真实MySQL、LangGraph或学习效果通过。

Given只有静态环境，When执行MySQL验证且未授权测试库，Then返回not_run和非零，且不连接或修改数据库。
Given已有其他分支未提交改动，When推送develop规格，Then不得混入这些改动或切换其分支。

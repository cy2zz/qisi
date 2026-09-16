# 实施设计

唯一ADR：qisi-sdd-v3/adr/ADR-001-stack.md；正文按qisi-3.1同步。机器选型stack.json；执行runtime.json；数据库contracts/database.sql/mysql.md；图/事务workflow-persistence.md。

本次仅修改规格，不安装依赖或改应用源码。独立worktree在develop；原develop-B-v1.0与其未提交配置不动。不使用开发子Agent（产品多Agent不等于委派授权）。

A/B具体实现任务仍在tasks.json，所有步骤同步进PRD和plan；validate_stack检查20张卡唯一且步骤一致。validate_spec不再用SQLite引擎执行MySQL SQL；真实数据库独立opt-in验证。

公开展示唯一来源是commitChecked成功后的安全DTO；checkpoint只做私有执行快照；SDK/图重试受统一预算约束。DB及saver适配必须实际通过ST，不得用静态通过替代运行能力。

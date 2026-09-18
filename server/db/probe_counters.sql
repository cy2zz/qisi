-- 诊断探针计数。DDL 源自 qisi-sdd-v3/contracts/database.sql 的 probe_counters。
--
-- 【无外键】原规格定义了 FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE，
-- 本次移除，原因见 runs.sql 头部。代价是删除会话不再自动清理本表，由应用层显式清理。
--
-- CHECK(shown_count BETWEEN 0 AND 2) 是教学红线的 SQL 强制：每 canonical goal 最多两次
-- 真实显示的诊断探针（AGENTS.md §6 第 5 条、runtime.json 的 probe_limit_per_canonical_goal）。
--
-- canonical_goal_key 由代码从已批准决策图推导（server/src/features/tutor/probe-counter.ts），
-- 补偿节点经 parent_goal_key 归并到父目标，因此换节点名不能重置预算
-- （contracts/README.md §7：「模型不可自己新建key逃避计数」）。
-- 该键刻意不出现在 domain.schema.json 中——它是服务端概念，不是模型契约字段。
CREATE TABLE probe_counters (
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  canonical_goal_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  shown_count INT NOT NULL DEFAULT 0 CHECK(shown_count BETWEEN 0 AND 2),
  PRIMARY KEY(session_id,task_id,canonical_goal_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

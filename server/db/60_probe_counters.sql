-- 诊断探针计数。源自规格 database.sql 的 probe_counters。
--
-- CHECK(shown_count BETWEEN 0 AND 2) 是教学红线的 SQL 强制：每 canonical goal 最多两次。
-- canonical_goal_key 由代码从已批准决策图推导（见 B03 的 probe-counter.ts），
-- 补偿节点经 parent_goal_key 归并到父目标，因此换节点名不能重置预算。
-- 已移除的跨领域外键（待补）：session_id -> sessions(id)。
CREATE TABLE probe_counters (
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  canonical_goal_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  shown_count INT NOT NULL DEFAULT 0 CHECK(shown_count BETWEEN 0 AND 2),
  PRIMARY KEY(session_id,task_id,canonical_goal_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

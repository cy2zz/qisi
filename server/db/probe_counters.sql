-- 诊断探针计数。
--
-- 规格依据：contracts/README.md §4「probe_counters | UNIQUE(session_id,task_id,
-- canonical_goal_key)，换节点名不重置」；contracts/mysql.md「关键唯一性和并发字段必须
-- 真实SQL约束，不能全靠内存数组」；AGENTS.md §6 第 5 条把「同一 canonical goal 最多两次
-- 教学探针」列为教学红线。
--
-- 限制由 CHECK 在 SQL 层强制，而不是只靠应用层计数：探针上限是教学红线，
-- 且「模型不可自己新建 key 逃避计数」（§7）——计数键必须落库，不能只活在请求内存里。
--
-- canonical_goal_key 由服务端从已批准决策图推导（见 server/src/features/tutor/probe-counter.ts），
-- 补偿节点经 parent_goal_key 归并到父目标，因此换节点名不能重置预算。
-- 该键刻意不出现在 domain.schema.json 中——它是服务端概念，不是模型契约字段。
CREATE TABLE `probe_counters` (
`session_id`         BIGINT UNSIGNED NOT NULL COMMENT '所属学习会话ID',
`task_id`            VARCHAR(191)    NOT NULL COMMENT '任务标识：原题或检验题',
`canonical_goal_key` VARCHAR(191)    NOT NULL COMMENT '规范目标键，服务端推导，模型不可自建',
`shown_count`        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '已真实显示的诊断探针次数',
`db_update_time`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`session_id`, `task_id`, `canonical_goal_key`),
CONSTRAINT `chk_probe_counters_limit` CHECK (`shown_count` BETWEEN 0 AND 2),
CONSTRAINT `fk_probe_counters_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '诊断探针计数表';

CREATE TABLE `seen_tasks` (
`id`                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '已见任务记录ID',
`user_id`                    BIGINT UNSIGNED NOT NULL COMMENT '所属学生用户ID',
`task_id`                    BIGINT UNSIGNED NOT NULL COMMENT '独立检验任务ID',
`task_hash`                  BINARY(32)      NOT NULL COMMENT '规范化题干摘要',
`equivalence_group`          VARCHAR(128)    NOT NULL COMMENT '等价任务组标识',
`first_seen_eligible`        TINYINT(1)      NOT NULL COMMENT '首次展示时是否满足独立检验资格',
`first_seen_at`              TIMESTAMP       NOT NULL COMMENT '首次向该学生展示时间',
`db_update_time`             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
UNIQUE KEY `uq_seen_tasks_user_task` (`user_id`, `task_id`),
UNIQUE KEY `uq_seen_tasks_user_hash` (`user_id`, `task_hash`),
KEY `idx_seen_tasks_user_equivalence` (`user_id`, `equivalence_group`),
CONSTRAINT `fk_seen_tasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
CONSTRAINT `fk_seen_tasks_task` FOREIGN KEY (`task_id`) REFERENCES `assessment_tasks` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '学生已见独立检验任务表';

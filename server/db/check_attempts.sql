CREATE TABLE `check_attempts` (
`id`                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '独立检验作答ID',
`session_id`                 BIGINT UNSIGNED NOT NULL COMMENT '原学习会话ID',
`user_id`                    BIGINT UNSIGNED NOT NULL COMMENT '所属学生用户ID',
`task_id`                    BIGINT UNSIGNED NOT NULL COMMENT '本次检验任务ID',
`phase`                      VARCHAR(32)     NOT NULL COMMENT '检验阶段',
`plan_draft_markdown`        MEDIUMTEXT      NOT NULL COMMENT '锁定前的计划草稿',
`locked_plan_markdown`       MEDIUMTEXT      NULL COMMENT '首次提交后锁定的计划',
`plan_unanswered`            TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '学生是否明确暂时没有计划',
`answer_draft_markdown`      MEDIUMTEXT      NOT NULL COMMENT '最终提交前的答案草稿',
`final_answer_markdown`      MEDIUMTEXT      NULL COMMENT '首次最终提交后冻结的答案',
`first_seen_eligible`        TINYINT(1)      NOT NULL COMMENT '任务首次展示时是否满足独立资格',
`assistance_requested`       TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '学生是否请求过帮助',
`help_exposed`               TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否实际展示过帮助',
`invalidated`                TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '本次检验是否因修订等原因失效',
`planning_result`            VARCHAR(24)     NULL COMMENT '计划评分结果',
`execution_result`           VARCHAR(24)     NULL COMMENT '执行评分结果',
`result_json`                JSON            NULL COMMENT '最终评分的安全公开结果及限制',
`version`                    INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT '作答并发控制版本',
`started_at`                 TIMESTAMP       NOT NULL COMMENT '检验开始时间',
`plan_locked_at`             TIMESTAMP       NULL COMMENT '计划锁定时间',
`finished_at`                TIMESTAMP       NULL COMMENT '最终答案冻结时间',
`db_update_time`             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
UNIQUE KEY `uq_check_attempts_session` (`session_id`),
KEY `idx_check_attempts_user_update` (`user_id`, `db_update_time`),
CONSTRAINT `fk_check_attempts_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE,
CONSTRAINT `fk_check_attempts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
CONSTRAINT `fk_check_attempts_task` FOREIGN KEY (`task_id`) REFERENCES `assessment_tasks` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '独立检验首次作答表';

-- migration: v3_022_check_attempts_started
-- 由 SqlMigrationProvider 在同一连接启用 explicit_defaults_for_timestamp 后执行。
-- 仅去除隐式自动时间属性，保留所有历史业务时间值。
ALTER TABLE `check_attempts`
  MODIFY COLUMN `started_at`                 TIMESTAMP       NOT NULL COMMENT '检验开始时间',
  ALGORITHM = INPLACE,
  LOCK = NONE;

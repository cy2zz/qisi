CREATE TABLE `learning_drafts` (
`session_id`      BIGINT UNSIGNED NOT NULL COMMENT '学习会话ID',
`user_id`         BIGINT UNSIGNED NOT NULL COMMENT '所属学生用户ID',
`draft_markdown`  MEDIUMTEXT      NOT NULL COMMENT '当前尚未发送的Markdown草稿',
`expires_at`      TIMESTAMP       NOT NULL COMMENT '草稿清理时间',
`db_update_time`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`session_id`),
KEY `idx_learning_drafts_user_expiry` (`user_id`, `expires_at`),
CONSTRAINT `fk_learning_drafts_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE,
CONSTRAINT `fk_learning_drafts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '学习页未发送草稿表';

-- migration: v3_023_learning_drafts_expiry
-- 由 SqlMigrationProvider 在同一连接启用 explicit_defaults_for_timestamp 后执行。
-- 仅去除隐式自动时间属性，保留所有历史业务时间值。
ALTER TABLE `learning_drafts`
  MODIFY COLUMN `expires_at`      TIMESTAMP       NOT NULL COMMENT '草稿清理时间',
  ALGORITHM = INPLACE,
  LOCK = NONE;

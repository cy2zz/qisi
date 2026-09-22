CREATE TABLE `transcripts` (
`id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '手写转写ID',
`user_id`          BIGINT UNSIGNED NOT NULL COMMENT '所属学生用户ID',
`session_id`       BIGINT UNSIGNED NULL COMMENT '关联学习会话ID',
`media_id`         BIGINT UNSIGNED NULL COMMENT '来源私有媒体ID，原图清理后可为空',
`revision`         INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT '转写确认并发版本',
`lines_json`       JSON            NOT NULL COMMENT '逐行转写、模糊标记与显式确认状态',
`confirmed`        TINYINT         NOT NULL DEFAULT 0 COMMENT '学生是否已确认当前版本',
`expires_at`       TIMESTAMP       NOT NULL COMMENT '未确认转写清理时间',
`db_update_time`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
KEY `idx_transcripts_user_expiry` (`user_id`, `expires_at`),
KEY `idx_transcripts_session` (`session_id`),
CONSTRAINT `fk_transcripts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
CONSTRAINT `fk_transcripts_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE,
CONSTRAINT `fk_transcripts_media` FOREIGN KEY (`media_id`) REFERENCES `media` (`id`) ON DELETE SET NULL
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '手写逐行转写与确认版本表';

-- migration: v3_025_transcripts_expiry
-- 由 SqlMigrationProvider 在同一连接启用 explicit_defaults_for_timestamp 后执行。
-- 仅去除隐式自动时间属性，保留所有历史业务时间值。
ALTER TABLE `transcripts`
  MODIFY COLUMN `expires_at`       TIMESTAMP       NOT NULL COMMENT '未确认转写清理时间',
  ALGORITHM = INPLACE,
  LOCK = NONE;

CREATE TABLE `media` (
`id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '私有媒体ID',
`user_id`          BIGINT UNSIGNED NOT NULL COMMENT '所属学生用户ID',
`session_id`       BIGINT UNSIGNED NULL COMMENT '关联学习会话ID，题目前置上传时为空',
`purpose`          VARCHAR(32)     NOT NULL COMMENT '媒体用途：题目或手写作答',
`private_path`     VARCHAR(1024)   NOT NULL COMMENT '服务端私有存储相对路径',
`mime`             VARCHAR(64)     NOT NULL COMMENT '已解码确认的图片类型',
`width`            INT UNSIGNED    NOT NULL COMMENT '图片宽度像素',
`height`           INT UNSIGNED    NOT NULL COMMENT '图片高度像素',
`expires_at`       TIMESTAMP       NOT NULL COMMENT '原图清理时间',
`db_update_time`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
KEY `idx_media_user_expiry` (`user_id`, `expires_at`),
KEY `idx_media_session` (`session_id`),
CONSTRAINT `fk_media_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
CONSTRAINT `fk_media_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '学生私有图片媒体表';

-- migration: v3_024_media_expiry
-- 由 SqlMigrationProvider 在同一连接启用 explicit_defaults_for_timestamp 后执行。
-- 仅去除隐式自动时间属性，保留所有历史业务时间值。
ALTER TABLE `media`
  MODIFY COLUMN `expires_at`       TIMESTAMP       NOT NULL COMMENT '原图清理时间',
  ALGORITHM = INPLACE,
  LOCK = NONE;

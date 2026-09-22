CREATE TABLE `requests` (
`id`                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '请求记录ID',
`user_id`            BIGINT UNSIGNED NOT NULL COMMENT '发起请求的学生用户ID',
`session_id`         BIGINT UNSIGNED NOT NULL COMMENT '所属学习会话ID',
`request_id`         CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '客户端幂等请求ID',
`payload_hash`       BINARY(32)      NOT NULL COMMENT '请求载荷SHA-256哈希',
`status`             VARCHAR(24)     NOT NULL COMMENT '请求处理状态',
`safe_response_json` JSON            NULL COMMENT '可向学生回放的安全响应',
`error_json`         JSON            NULL COMMENT '脱敏后的失败信息',
`expires_at`         TIMESTAMP       NOT NULL COMMENT '请求记录到期时间',
`db_update_time`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
UNIQUE KEY `uq_requests_user_request` (`user_id`, `request_id`),
KEY `idx_requests_session` (`session_id`),
CONSTRAINT `fk_requests_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
CONSTRAINT `fk_requests_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '学习请求幂等记录表';

-- migration: v3_017_requests_expiry
-- 由 SqlMigrationProvider 在同一连接启用 explicit_defaults_for_timestamp 后执行。
-- 仅去除隐式自动时间属性，保留所有历史业务时间值。
ALTER TABLE `requests`
  MODIFY COLUMN `expires_at`         TIMESTAMP       NOT NULL COMMENT '请求记录到期时间',
  ALGORITHM = INPLACE,
  LOCK = NONE;

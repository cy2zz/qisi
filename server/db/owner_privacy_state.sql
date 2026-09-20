CREATE TABLE `owner_privacy_state` (
`user_id`             BIGINT UNSIGNED NOT NULL COMMENT '学生用户ID',
`history_incomplete`  TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '保留期清理或主动删除后历史证据是否不完整',
`db_update_time`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`user_id`),
CONSTRAINT `fk_owner_privacy_state_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '学生历史证据完整性边界表';

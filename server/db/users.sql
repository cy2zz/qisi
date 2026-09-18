CREATE TABLE `users` (
`id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
`username`            VARCHAR(32)     NOT NULL COMMENT '学生输入的用户名',
`username_normalized` VARCHAR(64)     NOT NULL COMMENT '归一化用户名，用于唯一登录',
`cookie_token_hash`   BINARY(32)      NOT NULL COMMENT '登录Cookie Token的SHA-256哈希',
`db_update_time`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
UNIQUE KEY `uq_users_username_normalized` (`username_normalized`),
UNIQUE KEY `uq_users_cookie_token_hash` (`cookie_token_hash`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '学生用户表';

CREATE TABLE `learning_messages` (
`id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '公开学习消息ID',
`session_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属学习会话ID',
`request_id`       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT '产生消息的幂等请求ID',
`seq`              INT UNSIGNED    NOT NULL COMMENT '会话内公开消息序号',
`role`             VARCHAR(16)     NOT NULL COMMENT '消息角色',
`message_type`     VARCHAR(32)     NOT NULL COMMENT '消息业务类型',
`assistance_mode`  VARCHAR(32)     NULL COMMENT '实际发出的帮助深度',
`content_markdown` MEDIUMTEXT      NOT NULL COMMENT '通过守卫后的公开Markdown内容',
`metadata_json`    JSON            NULL COMMENT '公开消息附加状态',
`db_update_time`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
UNIQUE KEY `uq_learning_messages_session_seq` (`session_id`, `seq`),
CONSTRAINT `fk_learning_messages_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '学生与启思公开消息表';

CREATE TABLE `events` (
`id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '领域事件ID',
`session_id`          BIGINT UNSIGNED NOT NULL COMMENT '所属学习会话ID',
`seq`                 INT UNSIGNED    NOT NULL COMMENT '会话内事件序号',
`event_type`          VARCHAR(64)     NOT NULL COMMENT '不可变事件类型',
`subject_id`          VARCHAR(191)    NOT NULL COMMENT '事件主体标识',
`dependency_ids_json` JSON            NOT NULL COMMENT '事件依赖标识列表',
`payload_json`        JSON            NOT NULL COMMENT '脱敏后的事件事实',
`invalidated`         TINYINT         NOT NULL DEFAULT 0 COMMENT '事件是否因后续修订失效',
`db_update_time`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
UNIQUE KEY `uq_events_session_seq` (`session_id`, `seq`),
CONSTRAINT `fk_events_session` FOREIGN KEY (`session_id`) REFERENCES `sessions` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '学习领域事件事实表';

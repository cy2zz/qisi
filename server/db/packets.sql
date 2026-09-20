CREATE TABLE `packets` (
`problem_hash`              BINARY(32)       NOT NULL COMMENT '题目规范内容SHA-256摘要',
`version`                   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '提示、模型、配置与参考材料共同版本摘要',
`problem_id`                VARCHAR(128)     NOT NULL COMMENT '备课包关联题目标识',
`model_id`                  VARCHAR(255)     NOT NULL COMMENT '生成候选所用模型标识',
`prompt_version`            VARCHAR(128)     NOT NULL COMMENT 'Preparation提示版本',
`config_hash`               VARCHAR(128)     NOT NULL COMMENT '工作流配置版本摘要',
`packet_json`               JSON             NOT NULL COMMENT '经代码收口后的完整备课包',
`status`                    VARCHAR(24)      NOT NULL COMMENT '备课包状态，ready或needs_review',
`review_json`               JSON             NOT NULL COMMENT 'Guard与代码核对结果摘要',
`db_update_time`            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`problem_hash`, `version`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '题目备课包缓存表';

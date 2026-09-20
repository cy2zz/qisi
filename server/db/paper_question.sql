CREATE TABLE `paper_question` (
`id`                         BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT COMMENT '试卷题目关系ID',
`paper_id`                   BIGINT UNSIGNED   NOT NULL COMMENT '试卷ID',
`question_id`                BIGINT UNSIGNED   NOT NULL COMMENT '题目ID',
`question_number`            SMALLINT UNSIGNED NULL COMMENT '试卷内题号，未编号时为空',
`metadata_json`              JSON              NULL COMMENT '题目在试卷中的其他信息',
`db_update_time`             TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`             TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '试卷题目关系表';

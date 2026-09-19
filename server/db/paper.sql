CREATE TABLE `paper` (
`id`               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT COMMENT '试卷ID',
`paper_code`       VARCHAR(128)      NOT NULL COMMENT '试卷业务编码',
`title`            VARCHAR(255)      NOT NULL COMMENT '试卷标题',
`exam_year`        SMALLINT UNSIGNED NOT NULL COMMENT '考试年份',
`exam_type`        VARCHAR(32)       NOT NULL COMMENT '考试类型，例如高考',
`subject`          VARCHAR(32)       NOT NULL COMMENT '考试科目，例如数学',
`region`           VARCHAR(64)       NULL COMMENT '地区或卷种，例如北京、全国甲卷',
`is_official`      TINYINT UNSIGNED  NOT NULL COMMENT '是否为官方真题',
`metadata_json`    JSON              NULL COMMENT '来源文件、卷首说明和其他信息',
`status`           VARCHAR(24)       NOT NULL COMMENT '试卷状态',
`db_update_time`   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '历年考试试卷表';

CREATE TABLE `question` (
`id`                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '题目ID',
`question_code`              VARCHAR(128)    NULL COMMENT '题目业务编码，未生成时为空',
`statement_markdown`         MEDIUMTEXT      NULL COMMENT '结构化题干Markdown及LaTeX',
`analysis_markdown`          MEDIUMTEXT      NULL COMMENT '结构化解析Markdown及LaTeX',
`question_image_object_key`  VARCHAR(1024)   NULL COMMENT '题目图片OSS对象键',
`question_image_url`         VARCHAR(2048)   NULL COMMENT '题目图片公开地址',
`analysis_image_object_key`  VARCHAR(1024)   NULL COMMENT '解析图片OSS对象键',
`analysis_image_url`         VARCHAR(2048)   NULL COMMENT '解析图片公开地址',
`metadata_json`              JSON            NULL COMMENT '知识点、图片尺寸、切分位置和来源信息',
`status`                     VARCHAR(24)     NOT NULL COMMENT '题目状态',
`db_update_time`             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '题库题目表';

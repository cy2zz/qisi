CREATE TABLE `node_runs` (
`id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '节点执行记录ID',
`run_id`           CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '所属工作流运行ID',
`node_key`         VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '工作流节点标识',
`attempt`          INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT '节点尝试序号',
`input_hash`       BINARY(32)      NOT NULL COMMENT '节点输入与配置哈希',
`model_id`         VARCHAR(191)    NOT NULL DEFAULT '' COMMENT '实际调用的模型标识',
`prompt_version`   VARCHAR(191)    NOT NULL DEFAULT '' COMMENT '提示词版本',
`status`           VARCHAR(32)     NOT NULL COMMENT '节点执行状态',
`output_json`      JSON            NULL COMMENT '严格校验后的私有节点结果',
`usage_json`       JSON            NULL COMMENT '模型调用量与耗时',
`started_at`       TIMESTAMP       NOT NULL COMMENT '节点开始时间',
`finished_at`      TIMESTAMP       NULL COMMENT '节点完成时间',
`db_update_time`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
`db_create_time`   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
PRIMARY KEY (`id`),
UNIQUE KEY `uq_node_runs_run_node_attempt` (`run_id`, `node_key`, `attempt`),
CONSTRAINT `fk_node_runs_run` FOREIGN KEY (`run_id`) REFERENCES `runs` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COMMENT = '工作流节点执行记录表';

-- migration: v3_019_node_runs_started
-- 由 SqlMigrationProvider 在同一连接启用 explicit_defaults_for_timestamp 后执行。
-- 仅去除隐式自动时间属性，保留所有历史业务时间值。
ALTER TABLE `node_runs`
  MODIFY COLUMN `started_at`       TIMESTAMP       NOT NULL COMMENT '节点开始时间',
  ALGORITHM = INPLACE,
  LOCK = NONE;

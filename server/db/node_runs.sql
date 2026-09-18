-- 节点级执行记录：StorePort.getReusableNode / saveNode 的落点。
-- DDL 源自 qisi-sdd-v3/contracts/database.sql 的 node_runs。
--
-- 【无外键】原规格定义了 FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE，
-- 本次移除。原因见 runs.sql 头部：AGENTS.md:53 的命名规范与 Kysely 的字母序执行
-- 互斥，而 node_runs(n) 恰好排在 runs(r) 之前。代价是删除 run 不再自动清理本表，
-- 由应用层按 run_id 显式清理。
--
-- 复用条件由 PRIMARY KEY(run_id,node_key,attempt) 与 input_hash 共同约束：
-- 只有输入、模型、提示、配置的哈希全部一致才可复用（contracts/README.md §5 第 3 条）。
-- usage_json 承载 ModelCallRecord 的 token / 耗时 / usage_kind —— 这正是不需要
-- 独立 model_calls 表的依据之一（另一依据是 RunRecord.calls 已内嵌调用记录）。
CREATE TABLE node_runs (
  run_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  node_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt INT NOT NULL,
  input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  model_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  prompt_version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(32) NOT NULL,
  output_json JSON,
  usage_json JSON,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3),
  PRIMARY KEY(run_id,node_key,attempt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

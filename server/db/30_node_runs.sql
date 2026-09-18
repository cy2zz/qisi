-- 节点级执行记录：StorePort.getReusableNode / saveNode 的落点。源自规格 database.sql。
--
-- 复用条件由 PRIMARY KEY(run_id,node_key,attempt) 与 input_hash 共同约束：
-- 只有输入、模型、提示、配置的哈希全部一致才可复用（contracts/README.md §5 第 3 条）。
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
  PRIMARY KEY(run_id,node_key,attempt),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

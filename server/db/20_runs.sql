-- 工作流运行表：lease / fencing / deadline 的载体。源自规格 database.sql 的 runs。
--
-- 保留的外键：与 requests 的复合外键是 B 内部依赖，使请求幂等与 run 一致。
-- 已移除的跨领域外键（待补）：session_id -> sessions(id)、owner_id -> owners(id)。
--
-- 说明：lease_token 唯一且每次领取轮换，是「迟到结果不得提交」的执行机制。
CREATE TABLE runs (
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  owner_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  request_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  workflow VARCHAR(32) NOT NULL,
  lease_token VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  start_version INT,
  reserved_version INT,
  deadline_at DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL,
  run_json JSON NOT NULL,
  FOREIGN KEY (owner_id,request_id) REFERENCES requests(owner_id,request_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

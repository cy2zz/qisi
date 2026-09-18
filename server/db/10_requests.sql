-- 请求幂等表。DDL 源自 qisi-sdd-v3/contracts/database.sql 的 requests。
--
-- 已移除的跨领域外键（A 建好对应表后由后续迁移补加）：
--   FOREIGN KEY (owner_id)   REFERENCES owners(id)  ON DELETE CASCADE
--   FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
-- 移除原因：owners 尚未建表（A 当前实现为 users），sessions 归 A 的写集。
-- 注意：去掉外键不改变业务语义，owner 归属仍由服务端可信上下文保证，绝不接受客户端入参。
CREATE TABLE requests (
  owner_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) NOT NULL CHECK(status IN('in_progress','succeeded','failed')),
  safe_response_json JSON,
  error_json JSON,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY(owner_id,request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

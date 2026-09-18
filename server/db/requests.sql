-- 请求幂等表。DDL 源自 qisi-sdd-v3/contracts/database.sql 的 requests。
--
-- 【无外键】原规格定义了 FOREIGN KEY (owner_id) REFERENCES owners(id) 与
-- FOREIGN KEY (session_id) REFERENCES sessions(id)，本次移除。
-- 原因：AGENTS.md:53 的「一张表对应一个 <表名>.sql 文件」命名规范与 Kysely 的
-- 字母序执行互斥（详见 runs.sql 头部），项目方选择合规命名，故所有交叉外键移除。
--
-- 补充说明：owners 当前由 A 实现为 users 表，sessions 尚未建表。
-- 去掉外键不改变业务语义：owner 归属仍由服务端可信上下文保证，绝不接受客户端入参
-- （contracts/ports.ts 注释：The infrastructure derives owner from authenticated
-- server context, never ModelRequest or client input）。
--
-- PRIMARY KEY(owner_id,request_id) 是幂等键：同 ID 同 payload 返回原安全响应，
-- 不同 payload 返回 REQUEST_CONFLICT（contracts/README.md §5 第 1 条）。
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

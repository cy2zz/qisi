-- 工作流运行表：lease / fencing / deadline 的载体。
-- DDL 源自 qisi-sdd-v3/contracts/database.sql 的 runs。
--
-- 【无外键】本表按项目方决定不含任何 FOREIGN KEY。原规格定义了三个：
--   FOREIGN KEY (session_id)           REFERENCES sessions(id)           ON DELETE CASCADE
--   FOREIGN KEY (owner_id)             REFERENCES owners(id)             ON DELETE CASCADE
--   FOREIGN KEY (owner_id, request_id) REFERENCES requests(owner_id, request_id) ON DELETE CASCADE
-- 前两个指向 A 领域（sessions 尚未建表，owners 当前由 A 实现为 users）；
-- 第三个是 B 内部依赖，本次一并移除。
--
-- 移除原因：AGENTS.md:53 要求「一张表对应一个 <表名>.sql 文件」，而 Kysely 在
-- migrator.js:470-472 做 Object.keys(migrations).sort()，按迁移名【字母序】执行。
-- 字母序下 node_runs(n) 排在 runs(r) 之前，交叉外键必然建表失败。命名规范与
-- 外键依赖在此互斥，项目方选择合规命名。
--
-- 【代价，须知晓】失去级联删除：删除 run 不再自动清理其 node_runs 行。
-- 这与 contracts/mysql.md 的「FK级联是存储底线」相冲突，已上报项目方而非自行掩盖。
-- 应用层必须自行承担清理：删除/过期 run 时显式按 run_id 清理 node_runs。
--
-- lease_token 唯一且每次领取轮换，是「迟到结果不得提交」的执行机制
-- （contracts/README.md §5 第 7 条）。
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
  run_json JSON NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

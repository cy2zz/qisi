-- 领域事件：已发生的输入、公开消息、帮助曝光、修订、取消与删除。
-- DDL 源自 qisi-sdd-v3/contracts/database.sql 的 events。
--
-- 【无外键】原规格定义了 FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE，
-- 本次移除。原因见 runs.sql 头部：AGENTS.md:53 的命名规范与 Kysely 的字母序执行互斥，
-- 项目方选择合规命名。代价是删除会话不再自动清理本表，由应用层显式清理。
--
-- UNIQUE(session_id,seq) 使会话内事件单调有序，是「帮助不可撤销」与曝光追溯的依据
-- （AGENTS.md §6 第 6 条：实际曝光按契约记账，不因刷新、重答或撤回消息消除）。
-- invalidated 用于标记依赖已作废提交的事件，注意它不等于删除曝光记录。
CREATE TABLE events (
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  seq INT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  subject_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dependency_ids_json JSON NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  invalidated TINYINT NOT NULL DEFAULT 0 CHECK(invalidated IN(0,1)),
  UNIQUE(session_id,seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

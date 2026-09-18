-- 领域事件：已发生的输入、公开消息、帮助曝光、修订、取消与删除。源自规格 database.sql。
--
-- UNIQUE(session_id,seq) 使会话内事件单调有序，是「帮助不可撤销」与曝光追溯的依据。
-- 已移除的跨领域外键（待补）：session_id -> sessions(id)。
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

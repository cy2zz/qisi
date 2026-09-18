-- 教学包版本化快照。源自规格 database.sql 的 packets。
--
-- 键为 (problem_hash, version)：problem_hash 是内容哈希，题干或题图一变即产生新哈希，
-- 旧包自然不可命中——不依赖应用层「记得去失效」。这与 B02 的 PacketCache 一致。
-- ready 为 TINYINT 而非布尔，与 MySQL 的实际存储类型对齐。
CREATE TABLE packets (
  problem_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  packet_json JSON NOT NULL,
  ready TINYINT NOT NULL DEFAULT 0 CHECK(ready IN(0,1)),
  PRIMARY KEY(problem_hash,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

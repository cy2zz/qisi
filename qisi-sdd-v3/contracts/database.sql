-- qisi-3.1 MySQL 8.4 LTS initial specification migration; NOT runtime-verified yet.
-- Apply only to an empty dedicated database via versioned migration tooling.
-- MySQL DDL is not treated as a rollback-able business transaction.
SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TABLE schema_migrations (
  version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  applied_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE owners (
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  cookie_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin UNIQUE NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  history_incomplete TINYINT NOT NULL DEFAULT 0 CHECK(history_incomplete IN(0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE bank_manifests (
  version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  manifest_json JSON NOT NULL,
  scope_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  frozen_at DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE problems (
  bank_version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  problem_json JSON NOT NULL,
  status VARCHAR(24) NOT NULL CHECK(status IN('ready','needs_review','invalid')),
  PRIMARY KEY(bank_version,id),
  FOREIGN KEY (bank_version) REFERENCES bank_manifests(version) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE packets (
  problem_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  packet_json JSON NOT NULL,
  ready TINYINT NOT NULL DEFAULT 0 CHECK(ready IN(0,1)),
  PRIMARY KEY(problem_hash,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE sessions (
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  version INT NOT NULL CHECK(version>0),
  phase VARCHAR(32) NOT NULL,
  state_json JSON NOT NULL,
  problem_snapshot_json JSON NOT NULL,
  active_run_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  expires_at DATETIME(3) NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE requests (
  owner_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  request_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(24) NOT NULL CHECK(status IN('in_progress','succeeded','failed')),
  safe_response_json JSON,
  error_json JSON,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY(owner_id,request_id),
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

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
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id,request_id) REFERENCES requests(owner_id,request_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

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
  UNIQUE(session_id,seq),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE media (
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  purpose VARCHAR(16) NOT NULL CHECK(purpose IN('bank','handwriting')),
  private_path TEXT NOT NULL,
  content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mime VARCHAR(64) NOT NULL,
  width INT NOT NULL CHECK(width>0),
  height INT NOT NULL CHECK(height>0),
  expires_at DATETIME(3),
  CHECK((purpose='handwriting' AND owner_id IS NOT NULL AND expires_at IS NOT NULL) OR purpose='bank'),
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE transcripts (
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  media_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  revision INT NOT NULL,
  draft_json JSON NOT NULL,
  confirmed TINYINT NOT NULL DEFAULT 0 CHECK(confirmed IN(0,1)),
  expires_at DATETIME(3),
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE submission_revisions (
  submission_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision INT NOT NULL,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  submission_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY(submission_id,revision),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE probe_counters (
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  canonical_goal_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  shown_count INT NOT NULL DEFAULT 0 CHECK(shown_count BETWEEN 0 AND 2),
  PRIMARY KEY(session_id,task_id,canonical_goal_key),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE check_attempts (
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  owner_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equivalence_group VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attempt_json JSON NOT NULL,
  UNIQUE(owner_id,task_hash),
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE seen_tasks (
  owner_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  equivalence_group VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  first_seen_at DATETIME(3) NOT NULL,
  PRIMARY KEY(owner_id,task_hash),
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE teacher_grants (
  id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  session_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  teacher_cookie_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin,
  one_time_code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin UNIQUE,
  used_at DATETIME(3),
  expires_at DATETIME(3) NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE workflow_checkpoints (
  run_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checkpoint_ns VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checkpoint_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  parent_checkpoint_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin,
  checkpoint_type VARCHAR(64) NOT NULL,
  checkpoint_blob LONGBLOB NOT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(run_id,checkpoint_ns,checkpoint_id),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE workflow_writes (
  run_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checkpoint_ns VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  checkpoint_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_id VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  write_idx INT NOT NULL,
  channel VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  value_type VARCHAR(64) NOT NULL,
  value_blob LONGBLOB NOT NULL,
  task_path TEXT NOT NULL,
  PRIMARY KEY(run_id,checkpoint_ns,checkpoint_id,task_id,write_idx),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- No writes -> checkpoints FK: pending writes may precede the corresponding saved checkpoint.
-- Both are scoped to runs; application lease checks plus run FK prevent resurrection.
CREATE INDEX sessions_owner_expiry ON sessions(owner_id,expires_at);
CREATE INDEX runs_status_deadline ON runs(status,deadline_at);
CREATE INDEX seen_owner_group ON seen_tasks(owner_id,equivalence_group);

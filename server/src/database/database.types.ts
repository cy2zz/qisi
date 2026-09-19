import type { ColumnType, Generated } from 'kysely';

export interface UsersTable {
  id: Generated<string>;
  username: string;
  username_normalized: string;
  cookie_token_hash: Buffer;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface PaperTable {
  id: Generated<string>;
  paper_code: string;
  title: string;
  exam_year: number;
  exam_type: string;
  subject: string;
  region: string | null;
  is_official: number;
  metadata_json: ColumnType<unknown, string | null, string | null>;
  status: string;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface QuestionTable {
  id: Generated<string>;
  question_code: string | null;
  statement_markdown: string | null;
  analysis_markdown: string | null;
  question_image_object_key: string | null;
  question_image_url: string | null;
  analysis_image_object_key: string | null;
  analysis_image_url: string | null;
  metadata_json: ColumnType<unknown, string | null, string | null>;
  status: string;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface PaperQuestionTable {
  id: Generated<string>;
  paper_id: string;
  question_id: string;
  question_number: number | null;
  metadata_json: ColumnType<unknown, string | null, string | null>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  question_id: string | null;
  title: string;
  topic: string;
  problem_content_markdown: string;
  problem_markdown: string;
  analysis_json: ColumnType<unknown, string, string>;
  recognition_uncertain_json: ColumnType<unknown, string | null | undefined, string | null>;
  phase: string;
  version: number;
  next_message_seq: number;
  next_event_seq: number;
  active_run_id: string | null;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface RequestsTable {
  id: Generated<string>;
  user_id: string;
  session_id: string;
  request_id: string;
  payload_hash: Buffer;
  status: string;
  safe_response_json: ColumnType<unknown, string | null | undefined, string | null>;
  error_json: ColumnType<unknown, string | null | undefined, string | null>;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface RunsTable {
  id: string;
  session_id: string;
  user_id: string;
  request_id: string;
  workflow: string;
  lease_token: string;
  fencing_token: number;
  start_version: number;
  reserved_version: number;
  deadline_at: ColumnType<Date, Date | string, Date | string>;
  status: string;
  run_json: ColumnType<unknown, string, string>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface NodeRunsTable {
  id: Generated<string>;
  run_id: string;
  node_key: string;
  attempt: number;
  input_hash: Buffer;
  model_id: string;
  prompt_version: string;
  status: string;
  output_json: ColumnType<unknown, string | null | undefined, string | null>;
  usage_json: ColumnType<unknown, string | null | undefined, string | null>;
  started_at: ColumnType<Date, Date | string, Date | string>;
  finished_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface LearningMessagesTable {
  id: Generated<string>;
  session_id: string;
  request_id: string | null;
  seq: number;
  role: string;
  message_type: string;
  assistance_mode: string | null;
  content_markdown: string;
  metadata_json: ColumnType<unknown, string | null | undefined, string | null>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface EventsTable {
  id: Generated<string>;
  session_id: string;
  seq: number;
  event_type: string;
  subject_id: string;
  dependency_ids_json: ColumnType<unknown, string, string>;
  payload_json: ColumnType<unknown, string, string>;
  invalidated: number;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface AssessmentTasksTable {
  id: Generated<string>;
  user_id: string;
  source_session_id: string;
  source_question_id: string | null;
  prompt_markdown: string;
  reference_answer_markdown: string;
  rubric_json: ColumnType<unknown, string, string>;
  relation: string;
  equivalence_group: string;
  task_hash: Buffer;
  verification_json: ColumnType<unknown, string, string>;
  status: string;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface SeenTasksTable {
  id: Generated<string>;
  user_id: string;
  task_id: string;
  task_hash: Buffer;
  equivalence_group: string;
  first_seen_eligible: number;
  first_seen_at: ColumnType<Date, Date | string, Date | string>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface CheckAttemptsTable {
  id: Generated<string>;
  session_id: string;
  user_id: string;
  task_id: string;
  phase: string;
  plan_draft_markdown: string;
  locked_plan_markdown: string | null;
  plan_unanswered: number;
  answer_draft_markdown: string;
  final_answer_markdown: string | null;
  first_seen_eligible: number;
  assistance_requested: number;
  help_exposed: number;
  invalidated: number;
  planning_result: string | null;
  execution_result: string | null;
  result_json: ColumnType<unknown, string | null | undefined, string | null>;
  version: number;
  started_at: ColumnType<Date, Date | string, Date | string>;
  plan_locked_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  finished_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface OwnerPrivacyStateTable {
  user_id: string;
  history_incomplete: number;
  db_update_time: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  db_create_time: ColumnType<Date, Date | string | undefined, never>;
}

export interface Database {
  assessment_tasks: AssessmentTasksTable;
  check_attempts: CheckAttemptsTable;
  events: EventsTable;
  learning_messages: LearningMessagesTable;
  node_runs: NodeRunsTable;
  owner_privacy_state: OwnerPrivacyStateTable;
  paper: PaperTable;
  paper_question: PaperQuestionTable;
  question: QuestionTable;
  requests: RequestsTable;
  runs: RunsTable;
  seen_tasks: SeenTasksTable;
  sessions: SessionsTable;
  users: UsersTable;
}

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

export interface Database {
  paper: PaperTable;
  paper_question: PaperQuestionTable;
  question: QuestionTable;
  users: UsersTable;
}

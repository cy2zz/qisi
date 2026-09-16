import type { ColumnType } from 'kysely';

export interface AppMetadataTable {
  key: string;
  value: string;
  updated_at: ColumnType<Date, Date | string, Date | string>;
}

export interface Database {
  app_metadata: AppMetadataTable;
}

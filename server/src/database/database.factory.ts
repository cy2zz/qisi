import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import type { AppEnvironment } from '../config/env.js';
import type { Database } from './database.types.js';

export function createDatabase(environment: AppEnvironment) {
  const pool = createPool({
    host: environment.DB_HOST,
    port: environment.DB_PORT,
    database: environment.DB_NAME,
    user: environment.DB_USER,
    password: environment.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectionLimit: environment.DB_CONNECTION_LIMIT,
    connectTimeout: 10_000,
    enableKeepAlive: true,
    multipleStatements: false,
    ssl: environment.DB_SSL ? { rejectUnauthorized: true } : undefined,
  });

  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
    connection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
  });

  return new Kysely<Database>({
    dialect: new MysqlDialect({ pool }),
  });
}

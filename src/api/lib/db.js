import path from 'node:path';
import fs from 'node:fs';
import knexFactory from 'knex';
import { env } from './config.js';

const usePg = env.DATABASE_URL.startsWith('postgres');

if (!usePg) {
  fs.mkdirSync(path.dirname(env.SQLITE_PATH), { recursive: true });
}

export const db = usePg
  ? knexFactory({
      client: 'pg',
      connection: env.DATABASE_URL,
      pool: { min: 0, max: 10 }
    })
  : knexFactory({
      client: 'sqlite3',
      connection: { filename: env.SQLITE_PATH },
      useNullAsDefault: true,
      pool: {
        // SQLite is single-writer; serialize and wait instead of failing on lock.
        afterCreate: (conn, done) => {
          // WAL + щедрый busy_timeout: API и bot — два процесса на одном файле.
          conn.run('PRAGMA journal_mode = WAL;', () =>
            conn.run('PRAGMA foreign_keys = ON;', () =>
              conn.run('PRAGMA busy_timeout = 15000;', () =>
                conn.run('PRAGMA synchronous = NORMAL;', done)
              )
            )
          );
        }
      }
    });

export const dbClient = usePg ? 'pg' : 'sqlite3';

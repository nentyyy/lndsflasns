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
      // WAL даёт конкурентные чтения + одного писателя. Несколько соединений
      // для конкурентных запросов; busy_timeout заставляет SQLite сам ждать
      // освобождения write-lock (а не падать BUSY) при конкуренции api↔bot.
      // (max:1 приводил к acquire-timeout под нагрузкой, max+15s — к pile-up.)
      pool: {
        min: 1,
        max: 8,
        acquireTimeoutMillis: 20000,
        afterCreate: (conn, done) => {
          conn.run('PRAGMA journal_mode = WAL;', () =>
            conn.run('PRAGMA foreign_keys = ON;', () =>
              conn.run('PRAGMA busy_timeout = 5000;', () =>
                conn.run('PRAGMA synchronous = NORMAL;', done)
              )
            )
          );
        }
      }
    });

export const dbClient = usePg ? 'pg' : 'sqlite3';

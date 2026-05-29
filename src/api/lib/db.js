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
      // SQLite — один писатель. Пул из многих соединений конкурирует сам с
      // собой за write-lock и исчерпывается («pool is full» KnexTimeout, что
      // вешало clans/history/leaderboard/депозиты). Единственное соединение
      // сериализует запросы в процессе; WAL + busy_timeout разруливают
      // конкуренцию между процессами (api ↔ bot).
      pool: {
        min: 1,
        max: 1,
        acquireTimeoutMillis: 30000,
        afterCreate: (conn, done) => {
          conn.run('PRAGMA journal_mode = WAL;', () =>
            conn.run('PRAGMA foreign_keys = ON;', () =>
              conn.run('PRAGMA busy_timeout = 8000;', () =>
                conn.run('PRAGMA synchronous = NORMAL;', done)
              )
            )
          );
        }
      }
    });

export const dbClient = usePg ? 'pg' : 'sqlite3';

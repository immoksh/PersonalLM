import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Ordered, append-only migrations. Never edit a migration that has shipped —
 * add a new one, because applied ids are recorded and skipped on later boots.
 */
const MIGRATIONS: ReadonlyArray<{ id: string; sql: string }> = [
  {
    id: '001_initial_schema',
    sql: `
      CREATE TABLE users (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE notes (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        pinned     INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Matches the list query's ORDER BY so paging stays index-only.
      CREATE INDEX idx_notes_user_sort ON notes (user_id, pinned DESC, updated_at DESC);
    `,
  },
  {
    id: '002_sources',
    sql: `
      CREATE TABLE sources (
        id         TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('pdf', 'text', 'website', 'youtube', 'transcript')),
        title      TEXT NOT NULL,
        url        TEXT,
        video_id   TEXT,
        content    TEXT,
        preview    TEXT,
        file_name  TEXT,
        file_path  TEXT,
        file_size  INTEGER,
        mime_type  TEXT,
        status     TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'processing', 'failed')),
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_sources_user_created ON sources (user_id, created_at DESC);
      CREATE INDEX idx_sources_user_kind ON sources (user_id, kind);
    `,
  },
  {
    id: '003_google_identity',
    sql: `
      DROP TABLE IF EXISTS notes;

      ALTER TABLE users ADD COLUMN google_sub TEXT;
      ALTER TABLE users ADD COLUMN picture TEXT;

      -- Partial index: rows predating Google sign-in have a NULL sub, and NULLs
      -- must not collide with each other under the uniqueness constraint.
      CREATE UNIQUE INDEX idx_users_google_sub
        ON users (google_sub) WHERE google_sub IS NOT NULL;
    `,
  },
];

function connect(): Database.Database {
  if (env.databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
  }

  const database = new Database(env.databasePath);
  // WAL lets reads proceed during writes; without foreign_keys ON, SQLite
  // silently ignores the ON DELETE CASCADE above.
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  return database;
}

export const db = connect();

export function runMigrations(database: Database.Database = db): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS migrations (
       id         TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL
     );`,
  );

  const isApplied = database.prepare<[string]>('SELECT 1 FROM migrations WHERE id = ?');
  const record = database.prepare<[string, string]>(
    'INSERT INTO migrations (id, applied_at) VALUES (?, ?)',
  );

  for (const migration of MIGRATIONS) {
    if (isApplied.get(migration.id)) continue;

    // Each migration is one transaction: a failure mid-way leaves no partial schema.
    database.transaction(() => {
      database.exec(migration.sql);
      record.run(migration.id, new Date().toISOString());
    })();

    logger.info('Applied migration', { id: migration.id });
  }
}

export function closeDatabase(): void {
  db.close();
}

// Migrate at import time, not from the entrypoint. Services call `db.prepare()`
// at module scope, and ESM finishes evaluating this module before theirs — so
// migrating any later would hit "no such table" on a fresh database.
runMigrations();

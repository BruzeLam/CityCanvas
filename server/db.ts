import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'citycanvas.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS maps (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_maps_user ON maps(user_id);
`);

export type DbUser = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  created_at: string;
};

export type DbMap = {
  id: string;
  user_id: string;
  name: string;
  payload: string;
  updated_at: string;
  created_at: string;
};

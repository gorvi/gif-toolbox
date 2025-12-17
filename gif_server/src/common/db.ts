import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { CONFIG } from './config.js'

const require = createRequire(import.meta.url)
const sqlite3 = require('sqlite3') as typeof import('sqlite3')

sqlite3.verbose()

export type Db = import('sqlite3').Database

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

export function openDb(): Db {
  ensureDir(CONFIG.DATA_DIR)
  ensureDir(path.join(CONFIG.DATA_DIR, 'db'))
  const dbPath = path.join(CONFIG.DATA_DIR, 'db', 'app.sqlite3')
  const db = new sqlite3.Database(dbPath)
  return db
}

export function initDb(db: Db): Promise<void> {
  const sql = `
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  abs_path TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  input_file_id TEXT NOT NULL,
  output_file_id TEXT,
  params_json TEXT NOT NULL,
  progress REAL NOT NULL,
  error_message TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at_ms);
`
  return new Promise((resolve, reject) => {
    db.exec(sql, (err: Error | null) => (err ? reject(err) : resolve()))
  })
}

export function run(db: Db, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params as any, (err: Error | null) => (err ? reject(err) : resolve()))
  })
}

export function get<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params as any, (err: Error | null, row: any) => (err ? reject(err) : resolve(row as T | undefined)))
  })
}

export function all<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params as any, (err: Error | null, rows: any[]) => (err ? reject(err) : resolve(rows as T[])))
  })
}
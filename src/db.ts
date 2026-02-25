import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const STORE_DIR = path.join(PROJECT_ROOT, 'store')

mkdirSync(STORE_DIR, { recursive: true })

const DB_PATH = path.join(STORE_DIR, 'claudeclaw.db')
export const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ── Schema ────────────────────────────────────────────────────────────────────

export function initDatabase(): void {
  db.exec(`
    -- Sessions: maps chat_id → claude session_id
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Full memory: dual-sector salience decay model
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic_key TEXT,
      content TEXT NOT NULL,
      sector TEXT NOT NULL CHECK(sector IN ('semantic','episodic')),
      salience REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    );

    -- FTS5 virtual table for full-text search on memories
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
      USING fts5(content, content='memories', content_rowid='id');

    -- Triggers to keep FTS in sync with memories table
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
    END;

    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END;

    -- Simple conversation turns (fallback memory)
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- Scheduled tasks
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule TEXT NOT NULL,
      next_run INTEGER NOT NULL,
      last_run INTEGER,
      last_result TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status_next ON scheduled_tasks(status, next_run);

    -- WhatsApp outbox queue
    CREATE TABLE IF NOT EXISTS wa_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed'))
    );

    -- WhatsApp incoming messages
    CREATE TABLE IF NOT EXISTS wa_messages (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      from_me INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0
    );

    -- WhatsApp message ID → Telegram message ID mapping (for replies)
    CREATE TABLE IF NOT EXISTS wa_message_map (
      wa_id TEXT PRIMARY KEY,
      tg_msg_id INTEGER NOT NULL,
      chat_jid TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function getSession(chatId: string): string | undefined {
  const row = db.prepare('SELECT session_id FROM sessions WHERE chat_id = ?').get(chatId) as { session_id: string } | undefined
  return row?.session_id
}

export function setSession(chatId: string, sessionId: string): void {
  db.prepare(`
    INSERT INTO sessions (chat_id, session_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at
  `).run(chatId, sessionId, Math.floor(Date.now() / 1000))
}

export function clearSession(chatId: string): void {
  db.prepare('DELETE FROM sessions WHERE chat_id = ?').run(chatId)
}

// ── Full Memory CRUD ──────────────────────────────────────────────────────────

export interface Memory {
  id: number
  chat_id: string
  topic_key: string | null
  content: string
  sector: 'semantic' | 'episodic'
  salience: number
  created_at: number
  accessed_at: number
}

export function insertMemory(
  chatId: string,
  content: string,
  sector: 'semantic' | 'episodic',
  topicKey?: string
): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at)
    VALUES (?, ?, ?, ?, 1.0, ?, ?)
  `).run(chatId, topicKey ?? null, content, sector, now, now)
}

export function searchMemoriesFts(chatId: string, query: string, limit = 3): Memory[] {
  return db.prepare(`
    SELECT m.* FROM memories m
    JOIN memories_fts f ON m.id = f.rowid
    WHERE f.content MATCH ? AND m.chat_id = ?
    ORDER BY rank
    LIMIT ?
  `).all(query, chatId, limit) as Memory[]
}

export function getRecentMemories(chatId: string, limit = 5): Memory[] {
  return db.prepare(`
    SELECT * FROM memories WHERE chat_id = ?
    ORDER BY accessed_at DESC LIMIT ?
  `).all(chatId, limit) as Memory[]
}

export function touchMemory(id: number): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE memories SET accessed_at = ?, salience = MIN(salience + 0.1, 5.0) WHERE id = ?
  `).run(now, id)
}

export function decayMemories(): void {
  const cutoff = Math.floor(Date.now() / 1000) - 86400
  db.prepare(`
    UPDATE memories SET salience = salience * 0.98 WHERE created_at < ?
  `).run(cutoff)
  db.prepare(`DELETE FROM memories WHERE salience < 0.1`).run()
}

export function getMemoriesForChat(chatId: string, limit = 20): Memory[] {
  return db.prepare(`
    SELECT * FROM memories WHERE chat_id = ? ORDER BY accessed_at DESC LIMIT ?
  `).all(chatId, limit) as Memory[]
}

// ── Simple Turns ──────────────────────────────────────────────────────────────

export interface Turn {
  id: number
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

export function insertTurn(chatId: string, role: 'user' | 'assistant', content: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO turns (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)
  `).run(chatId, role, content, now)
}

export function getRecentTurns(chatId: string, limit = 10): Turn[] {
  return db.prepare(`
    SELECT * FROM turns WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(chatId, limit).reverse() as Turn[]
}

export function pruneOldTurns(chatId: string, keep = 50): void {
  db.prepare(`
    DELETE FROM turns WHERE chat_id = ? AND id NOT IN (
      SELECT id FROM turns WHERE chat_id = ? ORDER BY created_at DESC LIMIT ?
    )
  `).run(chatId, chatId, keep)
}

// ── Scheduled Tasks ───────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string
  chat_id: string
  prompt: string
  schedule: string
  next_run: number
  last_run: number | null
  last_result: string | null
  status: 'active' | 'paused'
  created_at: number
}

export function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void {
  db.prepare(`
    INSERT INTO scheduled_tasks (id, chat_id, prompt, schedule, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(task.id, task.chat_id, task.prompt, task.schedule, task.next_run, task.status, task.created_at)
}

export function getDueTasks(): ScheduledTask[] {
  const now = Math.floor(Date.now() / 1000)
  return db.prepare(`
    SELECT * FROM scheduled_tasks WHERE status = 'active' AND next_run <= ?
  `).all(now) as ScheduledTask[]
}

export function getAllTasks(): ScheduledTask[] {
  return db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as ScheduledTask[]
}

export function updateTaskAfterRun(id: string, result: string, nextRun: number): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    UPDATE scheduled_tasks SET last_run = ?, last_result = ?, next_run = ? WHERE id = ?
  `).run(now, result.slice(0, 500), nextRun, id)
}

export function setTaskStatus(id: string, status: 'active' | 'paused'): void {
  db.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?').run(status, id)
}

export function deleteTask(id: string): void {
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id)
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────

export interface WaMessage {
  id: string
  chat_jid: string
  from_me: number
  body: string
  timestamp: number
  notified: number
}

export function insertWaMessage(msg: WaMessage): void {
  db.prepare(`
    INSERT OR IGNORE INTO wa_messages (id, chat_jid, from_me, body, timestamp, notified)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.chat_jid, msg.from_me, msg.body, msg.timestamp, msg.notified)
}

export function getUnnotifiedWaMessages(): WaMessage[] {
  return db.prepare(`
    SELECT * FROM wa_messages WHERE notified = 0 ORDER BY timestamp ASC LIMIT 10
  `).all() as WaMessage[]
}

export function markWaMessageNotified(id: string): void {
  db.prepare('UPDATE wa_messages SET notified = 1 WHERE id = ?').run(id)
}

export interface WaOutbox {
  id?: number
  chat_jid: string
  message: string
  created_at: number
  sent_at?: number
  status: 'pending' | 'sent' | 'failed'
}

export function queueWaOutbox(chatJid: string, message: string): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`
    INSERT INTO wa_outbox (chat_jid, message, created_at, status) VALUES (?, ?, ?, 'pending')
  `).run(chatJid, message, now)
}

export function getPendingWaOutbox(): WaOutbox[] {
  return db.prepare(`
    SELECT * FROM wa_outbox WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10
  `).all() as WaOutbox[]
}

export function markWaOutboxSent(id: number): void {
  const now = Math.floor(Date.now() / 1000)
  db.prepare(`UPDATE wa_outbox SET status = 'sent', sent_at = ? WHERE id = ?`).run(now, id)
}

export function markWaOutboxFailed(id: number): void {
  db.prepare(`UPDATE wa_outbox SET status = 'failed' WHERE id = ?`).run(id)
}

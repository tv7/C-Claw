import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STORE_DIR = path.resolve(__dirname, '..', 'store')
const DB_PATH = path.join(STORE_DIR, 'claudeclaw.db')

mkdirSync(STORE_DIR, { recursive: true })

const db = new DatabaseSync(DB_PATH)

db.exec('PRAGMA journal_mode=WAL')
db.exec('PRAGMA foreign_keys=ON')

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

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

export interface Turn {
  id: number
  chat_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: number
}

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

export interface WaMessage {
  id: string
  chat_jid: string
  from_me: number
  body: string
  timestamp: number
  notified: number
}

export interface WaOutbox {
  id: number
  chat_jid: string
  message: string
  created_at: number
  sent_at: number | null
  status: 'pending' | 'sent' | 'failed'
}

// ---------------------------------------------------------------------------
// Schema initialization
// ---------------------------------------------------------------------------

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      chat_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      topic_key TEXT,
      content TEXT NOT NULL,
      sector TEXT NOT NULL CHECK(sector IN ('semantic','episodic')),
      salience REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      accessed_at INTEGER NOT NULL
    )
  `)

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
      USING fts5(content, content='memories', content_rowid='id')
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
      INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
    END
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)

  db.exec(`
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
    )
  `)

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status_next ON scheduled_tasks(status, next_run)
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      sent_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed'))
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_messages (
      id TEXT PRIMARY KEY,
      chat_jid TEXT NOT NULL,
      from_me INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_message_map (
      wa_id TEXT PRIMARY KEY,
      tg_msg_id INTEGER NOT NULL,
      chat_jid TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `)
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function getSession(chatId: string): string | null {
  const stmt = db.prepare('SELECT session_id FROM sessions WHERE chat_id = ?')
  const row = stmt.get(chatId) as { session_id: string } | undefined
  return row ? row.session_id : null
}

export function setSession(chatId: string, sessionId: string): void {
  const stmt = db.prepare(`
    INSERT INTO sessions (chat_id, session_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at
  `)
  stmt.run(chatId, sessionId, Date.now())
}

export function clearSession(chatId: string): void {
  const stmt = db.prepare('DELETE FROM sessions WHERE chat_id = ?')
  stmt.run(chatId)
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function insertMemory(
  chatId: string,
  content: string,
  sector: 'semantic' | 'episodic',
  topicKey?: string
): void {
  const now = Date.now()
  const stmt = db.prepare(`
    INSERT INTO memories (chat_id, topic_key, content, sector, salience, created_at, accessed_at)
    VALUES (?, ?, ?, ?, 1.0, ?, ?)
  `)
  stmt.run(chatId, topicKey ?? null, content, sector, now, now)
}

export function searchMemoriesFts(chatId: string, query: string, limit = 3): Memory[] {
  const stmt = db.prepare(`
    SELECT m.*
    FROM memories m
    JOIN memories_fts fts ON m.id = fts.rowid
    WHERE m.chat_id = ? AND memories_fts MATCH ?
    ORDER BY fts.rank
    LIMIT ?
  `)
  return stmt.all(chatId, query, limit) as unknown as Memory[]
}

export function getRecentMemories(chatId: string, limit = 5): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE chat_id = ?
    ORDER BY accessed_at DESC
    LIMIT ?
  `)
  return stmt.all(chatId, limit) as unknown as Memory[]
}

export function touchMemory(id: number): void {
  const stmt = db.prepare(`
    UPDATE memories
    SET accessed_at = ?,
        salience = MIN(salience + 0.1, 5.0)
    WHERE id = ?
  `)
  stmt.run(Date.now(), id)
}

export function decayMemories(): void {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  const decayStmt = db.prepare(`
    UPDATE memories
    SET salience = salience * 0.98
    WHERE accessed_at < ?
  `)
  decayStmt.run(sevenDaysAgo)

  const deleteStmt = db.prepare('DELETE FROM memories WHERE salience < 0.1')
  deleteStmt.run()
}

export function getMemoriesForChat(chatId: string, limit = 20): Memory[] {
  const stmt = db.prepare(`
    SELECT * FROM memories
    WHERE chat_id = ?
    ORDER BY salience DESC, accessed_at DESC
    LIMIT ?
  `)
  return stmt.all(chatId, limit) as unknown as Memory[]
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export function insertTurn(chatId: string, role: 'user' | 'assistant', content: string): void {
  const stmt = db.prepare(`
    INSERT INTO turns (chat_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `)
  stmt.run(chatId, role, content, Date.now())
}

export function getRecentTurns(chatId: string, limit = 10): Turn[] {
  const stmt = db.prepare(`
    SELECT * FROM (
      SELECT * FROM turns
      WHERE chat_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    ) ORDER BY created_at ASC
  `)
  return stmt.all(chatId, limit) as unknown as Turn[]
}

export function pruneOldTurns(chatId: string, keep = 50): void {
  const stmt = db.prepare(`
    DELETE FROM turns
    WHERE chat_id = ?
      AND id NOT IN (
        SELECT id FROM turns
        WHERE chat_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      )
  `)
  stmt.run(chatId, chatId, keep)
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function createTask(task: Omit<ScheduledTask, 'last_run' | 'last_result'>): void {
  const stmt = db.prepare(`
    INSERT INTO scheduled_tasks (id, chat_id, prompt, schedule, next_run, last_run, last_result, status, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)
  `)
  stmt.run(task.id, task.chat_id, task.prompt, task.schedule, task.next_run, task.status, task.created_at)
}

export function getDueTasks(now: number): ScheduledTask[] {
  const stmt = db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run <= ?
    ORDER BY next_run ASC
  `)
  return stmt.all(now) as unknown as ScheduledTask[]
}

export function getAllTasks(chatId?: string): ScheduledTask[] {
  if (chatId !== undefined) {
    const stmt = db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE chat_id = ?
      ORDER BY created_at DESC
    `)
    return stmt.all(chatId) as unknown as ScheduledTask[]
  }
  const stmt = db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
  return stmt.all() as unknown as ScheduledTask[]
}

export function updateTaskAfterRun(
  id: string,
  lastRun: number,
  nextRun: number,
  lastResult: string
): void {
  const stmt = db.prepare(`
    UPDATE scheduled_tasks
    SET last_run = ?, next_run = ?, last_result = ?
    WHERE id = ?
  `)
  stmt.run(lastRun, nextRun, lastResult, id)
}

export function setTaskStatus(id: string, status: 'active' | 'paused'): void {
  const stmt = db.prepare('UPDATE scheduled_tasks SET status = ? WHERE id = ?')
  stmt.run(status, id)
}

export function deleteTask(id: string): void {
  const stmt = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?')
  stmt.run(id)
}

// ---------------------------------------------------------------------------
// WhatsApp incoming
// ---------------------------------------------------------------------------

export function insertWaMessage(msg: Omit<WaMessage, 'notified'>): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO wa_messages (id, chat_jid, from_me, body, timestamp, notified)
    VALUES (?, ?, ?, ?, ?, 0)
  `)
  stmt.run(msg.id, msg.chat_jid, msg.from_me, msg.body, msg.timestamp)
}

export function getUnnotifiedWaMessages(): WaMessage[] {
  const stmt = db.prepare(`
    SELECT * FROM wa_messages
    WHERE notified = 0
    ORDER BY timestamp ASC
  `)
  return stmt.all() as unknown as WaMessage[]
}

export function markWaMessageNotified(id: string): void {
  const stmt = db.prepare('UPDATE wa_messages SET notified = 1 WHERE id = ?')
  stmt.run(id)
}

// ---------------------------------------------------------------------------
// WhatsApp outbox
// ---------------------------------------------------------------------------

export function queueWaOutbox(chatJid: string, message: string): void {
  const stmt = db.prepare(`
    INSERT INTO wa_outbox (chat_jid, message, created_at, sent_at, status)
    VALUES (?, ?, ?, NULL, 'pending')
  `)
  stmt.run(chatJid, message, Date.now())
}

export function getPendingWaOutbox(): WaOutbox[] {
  const stmt = db.prepare(`
    SELECT * FROM wa_outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC
  `)
  return stmt.all() as unknown as WaOutbox[]
}

export function markWaOutboxSent(id: number): void {
  const stmt = db.prepare(`
    UPDATE wa_outbox SET status = 'sent', sent_at = ? WHERE id = ?
  `)
  stmt.run(Date.now(), id)
}

export function markWaOutboxFailed(id: number): void {
  const stmt = db.prepare(`
    UPDATE wa_outbox SET status = 'failed' WHERE id = ?
  `)
  stmt.run(id)
}

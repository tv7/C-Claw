import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { unlinkSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const TEST_DB = path.join(PROJECT_ROOT, 'store', 'test.db')

describe('Database operations', () => {
  it('initializes database without errors', async () => {
    const { initDatabase } = await import('../db.js')
    expect(() => initDatabase()).not.toThrow()
  })

  it('can set and get a session', async () => {
    const { initDatabase, setSession, getSession } = await import('../db.js')
    initDatabase()
    setSession('test-chat-1', 'session-abc-123')
    const result = getSession('test-chat-1')
    expect(result).toBe('session-abc-123')
  })

  it('returns undefined for unknown chat', async () => {
    const { initDatabase, getSession } = await import('../db.js')
    initDatabase()
    const result = getSession('nonexistent-chat-99999')
    expect(result).toBeUndefined()
  })

  it('can clear a session', async () => {
    const { initDatabase, setSession, getSession, clearSession } = await import('../db.js')
    initDatabase()
    setSession('test-chat-2', 'session-xyz')
    clearSession('test-chat-2')
    const result = getSession('test-chat-2')
    expect(result).toBeUndefined()
  })

  it('can insert and retrieve memories', async () => {
    const { initDatabase, insertMemory, getRecentMemories } = await import('../db.js')
    initDatabase()
    insertMemory('chat-mem-1', 'I prefer TypeScript over JavaScript', 'semantic')
    const memories = getRecentMemories('chat-mem-1', 5)
    expect(memories.length).toBeGreaterThan(0)
    expect(memories.some(m => m.content.includes('TypeScript'))).toBe(true)
  })

  it('can create and retrieve scheduled tasks', async () => {
    const { initDatabase, createTask, getAllTasks, deleteTask } = await import('../db.js')
    initDatabase()
    const taskId = `test-task-${Date.now()}`
    const now = Math.floor(Date.now() / 1000)
    createTask({
      id: taskId,
      chat_id: 'test-chat',
      prompt: 'Test prompt',
      schedule: '0 9 * * *',
      next_run: now + 3600,
      status: 'active',
      created_at: now,
    })
    const tasks = getAllTasks()
    expect(tasks.some(t => t.id === taskId)).toBe(true)
    deleteTask(taskId)
    const tasksAfter = getAllTasks()
    expect(tasksAfter.some(t => t.id === taskId)).toBe(false)
  })

  it('upserts session correctly', async () => {
    const { initDatabase, setSession, getSession } = await import('../db.js')
    initDatabase()
    setSession('test-upsert', 'session-v1')
    setSession('test-upsert', 'session-v2')
    const result = getSession('test-upsert')
    expect(result).toBe('session-v2')
  })

  it('decay function runs without error', async () => {
    const { initDatabase, decayMemories } = await import('../db.js')
    initDatabase()
    expect(() => decayMemories()).not.toThrow()
  })
})

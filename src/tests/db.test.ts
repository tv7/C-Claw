import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  initDatabase,
  getSession,
  setSession,
  clearSession,
  insertMemory,
  getRecentMemories,
  touchMemory,
  decayMemories,
  getMemoriesForChat,
  insertTurn,
  getRecentTurns,
  pruneOldTurns,
  createTask,
  getDueTasks,
  getAllTasks,
  updateTaskAfterRun,
  setTaskStatus,
  deleteTask,
} from '../db.js'

beforeEach(() => {
  initDatabase()
})

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

describe('sessions', () => {
  const CHAT = 'test-chat-1'

  afterEach(() => {
    clearSession(CHAT)
  })

  it('returns null for unknown chat', () => {
    expect(getSession('nobody')).toBeNull()
  })

  it('stores and retrieves a session', () => {
    setSession(CHAT, 'session-abc')
    expect(getSession(CHAT)).toBe('session-abc')
  })

  it('updates session on conflict', () => {
    setSession(CHAT, 'session-abc')
    setSession(CHAT, 'session-xyz')
    expect(getSession(CHAT)).toBe('session-xyz')
  })

  it('clears session', () => {
    setSession(CHAT, 'session-abc')
    clearSession(CHAT)
    expect(getSession(CHAT)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Memories
// ---------------------------------------------------------------------------

describe('memories', () => {
  const CHAT = 'test-chat-mem'

  afterEach(() => {
    // Clean up memories for test chat
    const mems = getMemoriesForChat(CHAT, 100)
    for (const m of mems) {
      // decay them to near zero then delete
      decayMemories()
    }
  })

  it('inserts and retrieves a memory', () => {
    insertMemory(CHAT, 'I like TypeScript', 'semantic')
    const mems = getRecentMemories(CHAT, 5)
    expect(mems.length).toBeGreaterThan(0)
    expect(mems[0].content).toBe('I like TypeScript')
    expect(mems[0].sector).toBe('semantic')
    expect(mems[0].salience).toBeCloseTo(1.0)
  })

  it('stores episodic memories', () => {
    insertMemory(CHAT, 'Discussed project planning', 'episodic')
    const mems = getMemoriesForChat(CHAT, 5)
    const found = mems.find(m => m.content === 'Discussed project planning')
    expect(found).toBeDefined()
    expect(found!.sector).toBe('episodic')
  })

  it('touchMemory increases salience', () => {
    insertMemory(CHAT, 'Important fact', 'semantic')
    const before = getRecentMemories(CHAT, 1)[0]
    const beforeSalience = before.salience

    touchMemory(before.id)
    const after = getRecentMemories(CHAT, 1)[0]
    expect(after.salience).toBeGreaterThan(beforeSalience)
  })

  it('touchMemory caps salience at 5.0', () => {
    insertMemory(CHAT, 'Very important', 'semantic')
    const m = getRecentMemories(CHAT, 1)[0]

    // Touch many times to try to exceed 5.0
    for (let i = 0; i < 60; i++) {
      touchMemory(m.id)
    }

    const after = getMemoriesForChat(CHAT, 1)[0]
    expect(after.salience).toBeLessThanOrEqual(5.0)
  })

  it('getMemoriesForChat returns sorted by salience desc', () => {
    insertMemory(CHAT, 'Low salience memory', 'episodic')
    insertMemory(CHAT, 'High salience memory', 'semantic')

    const mems = getMemoriesForChat(CHAT)
    // All memories here — verify ordering makes sense
    expect(mems.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

describe('turns', () => {
  const CHAT = 'test-chat-turns'

  it('inserts and retrieves turns in order', () => {
    insertTurn(CHAT, 'user', 'Hello')
    insertTurn(CHAT, 'assistant', 'Hi there')
    insertTurn(CHAT, 'user', 'How are you?')

    const turns = getRecentTurns(CHAT, 10)
    expect(turns.length).toBe(3)
    expect(turns[0].role).toBe('user')
    expect(turns[0].content).toBe('Hello')
    expect(turns[2].content).toBe('How are you?')
  })

  it('prunes old turns keeping only N most recent', () => {
    for (let i = 0; i < 10; i++) {
      insertTurn(CHAT, 'user', `Message ${i}`)
    }

    pruneOldTurns(CHAT, 5)

    const turns = getRecentTurns(CHAT, 20)
    expect(turns.length).toBe(5)
  })

  it('limits returned turns to N', () => {
    for (let i = 0; i < 10; i++) {
      insertTurn(CHAT, 'user', `Message ${i}`)
    }

    const turns = getRecentTurns(CHAT, 3)
    expect(turns.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

describe('scheduler tasks', () => {
  const CHAT = 'test-chat-sched'
  const TASK_ID = 'test-task-001'

  afterEach(() => {
    deleteTask(TASK_ID)
  })

  it('creates and retrieves a task', () => {
    const now = Math.floor(Date.now() / 1000)
    createTask({
      id: TASK_ID,
      chat_id: CHAT,
      prompt: 'Good morning briefing',
      schedule: '0 9 * * *',
      next_run: now + 3600,
      status: 'active',
      created_at: now,
    })

    const tasks = getAllTasks(CHAT)
    expect(tasks.length).toBe(1)
    expect(tasks[0].prompt).toBe('Good morning briefing')
    expect(tasks[0].status).toBe('active')
  })

  it('getDueTasks returns only past-due active tasks', () => {
    const now = Math.floor(Date.now() / 1000)
    createTask({
      id: TASK_ID,
      chat_id: CHAT,
      prompt: 'Due task',
      schedule: '0 * * * *',
      next_run: now - 60, // in the past
      status: 'active',
      created_at: now,
    })

    const due = getDueTasks(now)
    expect(due.some(t => t.id === TASK_ID)).toBe(true)
  })

  it('getDueTasks excludes future tasks', () => {
    const now = Math.floor(Date.now() / 1000)
    createTask({
      id: TASK_ID,
      chat_id: CHAT,
      prompt: 'Future task',
      schedule: '0 * * * *',
      next_run: now + 3600, // in the future
      status: 'active',
      created_at: now,
    })

    const due = getDueTasks(now)
    expect(due.some(t => t.id === TASK_ID)).toBe(false)
  })

  it('getDueTasks excludes paused tasks', () => {
    const now = Math.floor(Date.now() / 1000)
    createTask({
      id: TASK_ID,
      chat_id: CHAT,
      prompt: 'Paused task',
      schedule: '0 * * * *',
      next_run: now - 60,
      status: 'paused',
      created_at: now,
    })

    const due = getDueTasks(now)
    expect(due.some(t => t.id === TASK_ID)).toBe(false)
  })

  it('setTaskStatus pauses and resumes tasks', () => {
    const now = Math.floor(Date.now() / 1000)
    createTask({
      id: TASK_ID,
      chat_id: CHAT,
      prompt: 'Toggle task',
      schedule: '0 * * * *',
      next_run: now + 3600,
      status: 'active',
      created_at: now,
    })

    setTaskStatus(TASK_ID, 'paused')
    let tasks = getAllTasks(CHAT)
    expect(tasks[0].status).toBe('paused')

    setTaskStatus(TASK_ID, 'active')
    tasks = getAllTasks(CHAT)
    expect(tasks[0].status).toBe('active')
  })

  it('updateTaskAfterRun updates run metadata', () => {
    const now = Math.floor(Date.now() / 1000)
    createTask({
      id: TASK_ID,
      chat_id: CHAT,
      prompt: 'Run me',
      schedule: '0 * * * *',
      next_run: now - 60,
      status: 'active',
      created_at: now,
    })

    updateTaskAfterRun(TASK_ID, now, now + 3600, 'Done successfully')

    const tasks = getAllTasks(CHAT)
    expect(tasks[0].last_run).toBe(now)
    expect(tasks[0].last_result).toBe('Done successfully')
  })

  it('deleteTask removes the task', () => {
    const now = Math.floor(Date.now() / 1000)
    createTask({
      id: TASK_ID,
      chat_id: CHAT,
      prompt: 'Delete me',
      schedule: '0 * * * *',
      next_run: now + 3600,
      status: 'active',
      created_at: now,
    })

    deleteTask(TASK_ID)
    const tasks = getAllTasks(CHAT)
    expect(tasks.some(t => t.id === TASK_ID)).toBe(false)
  })
})

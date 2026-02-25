#!/usr/bin/env node
import { fileURLToPath } from 'url'
import path from 'path'
import crypto from 'crypto'
import { initDatabase, createTask, getAllTasks, deleteTask, setTaskStatus } from './db.js'
import { computeNextRun } from './scheduler.js'
import { logger } from './logger.js'

// Suppress logger output for CLI
process.env['LOG_LEVEL'] = 'error'

initDatabase()

const args = process.argv.slice(2)
const cmd = args[0]

function printUsage() {
  console.log(`
Usage:
  node dist/schedule-cli.js create "<prompt>" "<cron>" <chat_id>
  node dist/schedule-cli.js list
  node dist/schedule-cli.js delete <id>
  node dist/schedule-cli.js pause <id>
  node dist/schedule-cli.js resume <id>

Examples:
  node dist/schedule-cli.js create "Summarize my emails" "0 9 * * *" 123456789
  node dist/schedule-cli.js list
  node dist/schedule-cli.js pause task-abc123
  `)
}

switch (cmd) {
  case 'create': {
    const [, prompt, schedule, chatId] = args
    if (!prompt || !schedule || !chatId) {
      console.error('Error: create requires <prompt>, <cron>, and <chat_id>')
      printUsage()
      process.exit(1)
    }
    try {
      const nextRun = computeNextRun(schedule)
      const id = `task-${crypto.randomBytes(4).toString('hex')}`
      const now = Math.floor(Date.now() / 1000)
      createTask({ id, chat_id: chatId, prompt, schedule, next_run: nextRun, status: 'active', created_at: now })
      console.log(`Created task: ${id}`)
      console.log(`Next run: ${new Date(nextRun * 1000).toLocaleString()}`)
    } catch (err) {
      console.error(`Error: ${String(err)}`)
      process.exit(1)
    }
    break
  }
  case 'list': {
    const tasks = getAllTasks()
    if (tasks.length === 0) {
      console.log('No scheduled tasks.')
      break
    }
    console.log('\nScheduled Tasks:')
    console.log('─'.repeat(80))
    for (const t of tasks) {
      const next = t.next_run ? new Date(t.next_run * 1000).toLocaleString() : 'N/A'
      const last = t.last_run ? new Date(t.last_run * 1000).toLocaleString() : 'Never'
      console.log(`ID: ${t.id} | Status: ${t.status} | Schedule: ${t.schedule}`)
      console.log(`   Prompt: ${t.prompt.slice(0, 60)}${t.prompt.length > 60 ? '...' : ''}`)
      console.log(`   Next: ${next} | Last: ${last}`)
      console.log('─'.repeat(80))
    }
    break
  }
  case 'delete': {
    const [, id] = args
    if (!id) { console.error('Error: delete requires <id>'); process.exit(1) }
    deleteTask(id)
    console.log(`Deleted task: ${id}`)
    break
  }
  case 'pause': {
    const [, id] = args
    if (!id) { console.error('Error: pause requires <id>'); process.exit(1) }
    setTaskStatus(id, 'paused')
    console.log(`Paused task: ${id}`)
    break
  }
  case 'resume': {
    const [, id] = args
    if (!id) { console.error('Error: resume requires <id>'); process.exit(1) }
    setTaskStatus(id, 'active')
    console.log(`Resumed task: ${id}`)
    break
  }
  default:
    printUsage()
    if (cmd) process.exit(1)
}

import { randomUUID } from 'crypto'
import { parseExpression } from 'cron-parser'
import {
  initDatabase,
  createTask,
  getAllTasks,
  deleteTask,
  setTaskStatus,
  ScheduledTask,
} from './db.js'
import { computeNextRun } from './scheduler.js'

initDatabase()

const [, , command, ...rest] = process.argv

function validateCron(expr: string): boolean {
  try {
    parseExpression(expr)
    return true
  } catch {
    return false
  }
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len - 1) + '…' : str
}

function formatDate(unixSeconds: number | null): string {
  if (unixSeconds === null) return 'never'
  return new Date(unixSeconds * 1000).toLocaleString()
}

function printTable(tasks: ScheduledTask[]): void {
  if (tasks.length === 0) {
    console.log('No scheduled tasks.')
    return
  }

  const header = ['ID', 'PROMPT', 'SCHEDULE', 'STATUS', 'NEXT RUN']
  const rows = tasks.map(t => [
    t.id.slice(0, 8),
    truncate(t.prompt, 40),
    t.schedule,
    t.status,
    formatDate(t.next_run),
  ])

  const colWidths = header.map((h, i) =>
    Math.max(h.length, ...rows.map(r => r[i].length))
  )

  const divider = colWidths.map(w => '-'.repeat(w)).join('-+-')
  const fmt = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ')

  console.log(fmt(header))
  console.log(divider)
  for (const row of rows) {
    console.log(fmt(row))
  }
}

switch (command) {
  case 'create': {
    // create "<prompt>" "<cron>" <chat_id>
    if (rest.length < 3) {
      console.error('Usage: schedule-cli create "<prompt>" "<cron>" <chat_id>')
      process.exit(1)
    }

    const prompt = rest[0]
    const cron = rest[1]
    const chatId = rest[2]

    if (!validateCron(cron)) {
      console.error(`Invalid cron expression: "${cron}"`)
      process.exit(1)
    }

    const id = randomUUID()
    const nextRun = computeNextRun(cron)
    const now = Math.floor(Date.now() / 1000)

    createTask({
      id,
      chat_id: chatId,
      prompt,
      schedule: cron,
      next_run: nextRun,
      status: 'active',
      created_at: now,
    })

    console.log(`Created task: ${id}`)
    console.log(`Next run: ${formatDate(nextRun)}`)
    break
  }

  case 'list': {
    const tasks = getAllTasks()
    printTable(tasks)
    break
  }

  case 'delete': {
    const id = rest[0]
    if (!id) {
      console.error('Usage: schedule-cli delete <id>')
      process.exit(1)
    }
    deleteTask(id)
    console.log(`Deleted task: ${id}`)
    break
  }

  case 'pause': {
    const id = rest[0]
    if (!id) {
      console.error('Usage: schedule-cli pause <id>')
      process.exit(1)
    }
    setTaskStatus(id, 'paused')
    console.log(`Paused task: ${id}`)
    break
  }

  case 'resume': {
    const id = rest[0]
    if (!id) {
      console.error('Usage: schedule-cli resume <id>')
      process.exit(1)
    }
    setTaskStatus(id, 'active')
    console.log(`Resumed task: ${id}`)
    break
  }

  default: {
    console.log(`ClaudeClaw Scheduler CLI

Commands:
  create "<prompt>" "<cron>" <chat_id>   Create a new scheduled task
  list                                    List all scheduled tasks
  delete <id>                             Delete a task
  pause <id>                              Pause a task
  resume <id>                             Resume a paused task`)
    process.exit(0)
  }
}

process.exit(0)

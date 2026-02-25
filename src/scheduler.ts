import { CronExpression, parseExpression } from 'cron-parser'
import { getDueTasks, updateTaskAfterRun } from './db.js'
import { runAgent } from './agent.js'
import { logger } from './logger.js'

export type Sender = (chatId: string, text: string) => Promise<void>

let schedulerInterval: ReturnType<typeof setInterval> | null = null

/**
 * Compute the Unix timestamp (seconds) for the next cron occurrence.
 */
export function computeNextRun(cronExpression: string): number {
  const parsed = parseExpression(cronExpression)
  return Math.floor(parsed.next().getTime() / 1000)
}

/**
 * Run all due scheduled tasks.
 */
export async function runDueTasks(send: Sender): Promise<void> {
  const tasks = getDueTasks()
  for (const task of tasks) {
    logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 50) }, 'Running scheduled task')
    try {
      await send(task.chat_id, `Running scheduled task: "${task.prompt.slice(0, 80)}..."`)
      const result = await runAgent(task.prompt)
      const text = result.text ?? '(no response)'
      await send(task.chat_id, `Scheduled task result:\n\n${text}`)
      const nextRun = computeNextRun(task.schedule)
      updateTaskAfterRun(task.id, text, nextRun)
    } catch (err) {
      logger.error({ err, taskId: task.id }, 'Scheduled task failed')
      await send(task.chat_id, `Scheduled task failed: ${String(err)}`)
    }
  }
}

/**
 * Initialize the scheduler polling loop.
 */
export function initScheduler(send: Sender): void {
  if (schedulerInterval) return
  logger.info('Scheduler started (60s poll)')
  schedulerInterval = setInterval(() => {
    runDueTasks(send).catch(err => logger.error({ err }, 'Scheduler poll error'))
  }, 60_000)
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}

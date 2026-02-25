import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { logger } from './logger.js'
import { TELEGRAM_BOT_TOKEN, STORE_DIR } from './config.js'
import { initDatabase } from './db.js'
import { runDecaySweep } from './memory.js'
import { cleanupOldUploads } from './media.js'
import { createBot, sendMessage } from './bot.js'
import { initScheduler, stopScheduler } from './scheduler.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PID_FILE = path.join(STORE_DIR, 'claudeclaw.pid')

// ---------------------------------------------------------------------------
// Lock file
// ---------------------------------------------------------------------------

function acquireLock(): void {
  mkdirSync(STORE_DIR, { recursive: true })

  if (existsSync(PID_FILE)) {
    const existing = readFileSync(PID_FILE, 'utf8').trim()
    const pid = Number(existing)

    if (!isNaN(pid) && pid > 0) {
      try {
        process.kill(pid, 0) // throws if not alive
        logger.info({ pid }, 'Killing stale instance')
        process.kill(pid, 'SIGTERM')
      } catch {
        // Process not alive — stale PID file, safe to overwrite
      }
    }
  }

  writeFileSync(PID_FILE, String(process.pid), 'utf8')
}

function releaseLock(): void {
  try {
    if (existsSync(PID_FILE)) {
      unlinkSync(PID_FILE)
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to release lock file')
  }
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

function showBanner(): void {
  try {
    const bannerPath = path.resolve(__dirname, '..', 'banner.txt')
    if (existsSync(bannerPath)) {
      console.log(readFileSync(bannerPath, 'utf8'))
    } else {
      console.log('=== ClaudeClaw ===')
    }
  } catch {
    console.log('=== ClaudeClaw ===')
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  showBanner()

  if (!TELEGRAM_BOT_TOKEN) {
    logger.error('TELEGRAM_BOT_TOKEN is not set. Run npm run setup or add it to .env.')
    process.exit(1)
  }

  acquireLock()

  initDatabase()
  logger.info('Database initialized')

  runDecaySweep()
  setInterval(runDecaySweep, 24 * 60 * 60 * 1000)

  cleanupOldUploads()

  const bot = createBot()

  const sender = async (chatId: string, text: string): Promise<void> => {
    await sendMessage(bot, chatId, text)
  }

  initScheduler(sender)

  const shutdown = async () => {
    logger.info('Shutting down...')
    stopScheduler()
    releaseLock()
    await bot.stop()
    process.exit(0)
  }

  process.once('SIGINT', () => { shutdown().catch(() => process.exit(1)) })
  process.once('SIGTERM', () => { shutdown().catch(() => process.exit(1)) })

  logger.info('Starting Telegram bot...')

  try {
    await bot.start({
      onStart: () => logger.info('ClaudeClaw running'),
    })
  } catch (err) {
    logger.error({ err }, 'Bot failed to start')
    releaseLock()
    process.exit(1)
  }
}

main().catch(err => {
  logger.error({ err }, 'Fatal error')
  releaseLock()
  process.exit(1)
})

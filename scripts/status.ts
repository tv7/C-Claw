#!/usr/bin/env tsx
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { readEnvFile } from '../src/env.js'
import https from 'https'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

const env = readEnvFile()

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'

function ok(msg: string) {
  console.log(`${GREEN}✓${RESET} ${msg}`)
}

function warn(msg: string) {
  console.log(`${YELLOW}⚠${RESET} ${msg}`)
}

function fail(msg: string) {
  console.log(`${RED}✗${RESET} ${msg}`)
}

function header(msg: string) {
  console.log(`\n${BOLD}${msg}${RESET}`)
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Node.js version
// ---------------------------------------------------------------------------

header('Node.js')
const nodeVersion = process.version
const major = parseInt(nodeVersion.replace('v', '').split('.')[0], 10)
if (major >= 22) {
  ok(`Node ${nodeVersion}`)
} else if (major >= 20) {
  warn(`Node ${nodeVersion} (>=22.5.0 recommended for built-in sqlite)`)
} else {
  fail(`Node ${nodeVersion} — requires >=20`)
}

// ---------------------------------------------------------------------------
// Claude CLI
// ---------------------------------------------------------------------------

header('Claude CLI')
const claudeVersion = tryExec('claude --version')
if (claudeVersion) {
  ok(`claude ${claudeVersion}`)
} else {
  fail('claude CLI not found — install from https://claude.ai/code')
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

header('Telegram')
const botToken = env['TELEGRAM_BOT_TOKEN'] ?? ''
const chatId = env['ALLOWED_CHAT_ID'] ?? env['ALLOWED_CHAT_IDS']?.split(',')[0] ?? ''

if (!botToken) {
  fail('TELEGRAM_BOT_TOKEN not set')
} else {
  // Validate token via getMe
  const result = await new Promise<boolean>(resolve => {
    https.get(`https://api.telegram.org/bot${botToken}/getMe`, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as { ok: boolean; result?: { username?: string } }
          resolve(body.ok)
        } catch {
          resolve(false)
        }
      })
    }).on('error', () => resolve(false))
  })

  if (result) {
    ok(`Bot token valid`)
  } else {
    fail(`Bot token invalid or unreachable`)
  }
}

if (chatId) {
  ok(`Chat ID configured: ${chatId}`)
} else {
  warn('ALLOWED_CHAT_ID not set — bot will accept messages from any chat')
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

header('Voice')
const groqKey = env['GROQ_API_KEY'] ?? ''
const elKey = env['ELEVENLABS_API_KEY'] ?? ''
const elVoice = env['ELEVENLABS_VOICE_ID'] ?? ''

if (groqKey) {
  ok('Groq STT configured')
} else {
  warn('GROQ_API_KEY not set — voice transcription disabled')
}

if (elKey && elVoice) {
  ok('ElevenLabs TTS configured')
} else if (elKey) {
  warn('ELEVENLABS_API_KEY set but ELEVENLABS_VOICE_ID missing')
} else {
  warn('ElevenLabs not configured — voice replies disabled')
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

header('Database')
const dbPath = path.join(PROJECT_ROOT, 'store', 'claudeclaw.db')
if (existsSync(dbPath)) {
  ok(`Database exists at ${dbPath}`)
  try {
    const { initDatabase, getMemoriesForChat, getAllTasks } = await import('../src/db.js')
    initDatabase()
    const mems = getMemoriesForChat('*', 1000)
    const tasks = getAllTasks()
    ok(`Memories: ${mems.length}`)
    ok(`Scheduled tasks: ${tasks.length}`)
  } catch (err) {
    warn(`Could not query DB: ${err}`)
  }
} else {
  warn(`Database not found — will be created on first start`)
}

// ---------------------------------------------------------------------------
// Background service
// ---------------------------------------------------------------------------

header('Background Service')
const platform = process.platform

if (platform === 'darwin') {
  const plistPath = path.join(process.env.HOME ?? '', 'Library', 'LaunchAgents', 'com.claudeclaw.app.plist')
  if (existsSync(plistPath)) {
    const status = tryExec('launchctl list com.claudeclaw.app')
    if (status && !status.includes('not found')) {
      ok('launchd service registered and running')
    } else {
      warn('launchd plist exists but service may not be loaded')
    }
  } else {
    warn('launchd plist not found — run npm run setup to install')
  }
} else if (platform === 'linux') {
  const status = tryExec('systemctl --user is-active claudeclaw')
  if (status === 'active') {
    ok('systemd service active')
  } else {
    warn(`systemd service status: ${status ?? 'not found'} — run npm run setup to install`)
  }
} else {
  warn('Windows — use PM2: pm2 list')
}

console.log()

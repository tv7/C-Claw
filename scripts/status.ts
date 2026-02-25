#!/usr/bin/env tsx
/**
 * ClaudeClaw Status Checker
 * Run: npm run status
 */
import { execSync, spawnSync } from 'child_process'
import https from 'https'
import { existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
}

const ok = (label: string, detail = '') => console.log(`${C.green}✓${C.reset} ${label}${detail ? ` — ${C.cyan}${detail}${C.reset}` : ''}`)
const warn = (label: string, detail = '') => console.log(`${C.yellow}⚠${C.reset} ${label}${detail ? ` — ${detail}` : ''}`)
const fail = (label: string, detail = '') => console.log(`${C.red}✗${C.reset} ${label}${detail ? ` — ${detail}` : ''}`)

function readEnv(): Record<string, string> {
  const envPath = path.join(PROJECT_ROOT, '.env')
  if (!existsSync(envPath)) return {}
  const result: Record<string, string> = {}
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

async function checkTelegramToken(token: string): Promise<boolean> {
  return new Promise(resolve => {
    https.get(`https://api.telegram.org/bot${token}/getMe`, (res) => {
      let data = ''
      res.on('data', (c: Buffer) => { data += c.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { ok: boolean; result?: { username: string } }
          if (parsed.ok) {
            ok('Telegram bot token', `@${parsed.result?.username}`)
            resolve(true)
          } else {
            fail('Telegram bot token', 'invalid')
            resolve(false)
          }
        } catch {
          fail('Telegram bot token', 'could not parse response')
          resolve(false)
        }
      })
    }).on('error', (e: Error) => {
      fail('Telegram bot token', e.message)
      resolve(false)
    })
  })
}

async function main(): Promise<void> {
  console.log(`\n${C.bold}ClaudeClaw Status${C.reset}\n`)

  // Node version
  const [major] = process.versions.node.split('.').map(Number)
  if (major >= 20) ok('Node.js', process.versions.node)
  else fail('Node.js', `${process.versions.node} (need >=20)`)

  // Claude CLI
  const claudeResult = spawnSync('claude', ['--version'], { encoding: 'utf-8' })
  if (claudeResult.status === 0) ok('claude CLI', claudeResult.stdout.trim())
  else fail('claude CLI', 'not found — install from https://claude.ai/code')

  // .env
  const envPath = path.join(PROJECT_ROOT, '.env')
  if (existsSync(envPath)) ok('.env file', envPath)
  else fail('.env file', 'not found — run npm run setup')

  const env = readEnv()

  // Telegram token
  const token = env['TELEGRAM_BOT_TOKEN'] ?? ''
  if (token) {
    await checkTelegramToken(token)
  } else {
    fail('Telegram bot token', 'not configured')
  }

  // Chat ID
  const chatId = env['ALLOWED_CHAT_ID'] ?? ''
  if (chatId) ok('Chat ID', chatId)
  else warn('Chat ID', 'not set — send /chatid to your bot')

  // Voice
  const groqKey = env['GROQ_API_KEY'] ?? ''
  if (groqKey) ok('Groq STT', 'configured')
  else warn('Groq STT', 'not configured (optional)')

  const elKey = env['ELEVENLABS_API_KEY'] ?? ''
  const elVoice = env['ELEVENLABS_VOICE_ID'] ?? ''
  if (elKey && elVoice) ok('ElevenLabs TTS', 'configured')
  else warn('ElevenLabs TTS', 'not configured (optional)')

  // Video
  const googleKey = env['GOOGLE_API_KEY'] ?? ''
  if (googleKey) ok('Google Gemini', 'configured')
  else warn('Google Gemini', 'not configured (optional)')

  // Database
  const dbPath = path.join(PROJECT_ROOT, 'store', 'claudeclaw.db')
  if (existsSync(dbPath)) {
    ok('SQLite database', dbPath)
  } else {
    warn('SQLite database', 'not found — will be created on first start')
  }

  // Dist build
  const distIndex = path.join(PROJECT_ROOT, 'dist', 'index.js')
  if (existsSync(distIndex)) ok('Build', 'dist/index.js exists')
  else warn('Build', 'not built — run npm run build')

  // Service status
  console.log()
  if (process.platform === 'darwin') {
    try {
      const r = execSync('launchctl list com.claudeclaw.app 2>/dev/null', { encoding: 'utf-8' })
      if (r.trim()) ok('macOS service', 'running (launchd)')
      else warn('macOS service', 'not loaded')
    } catch {
      warn('macOS service', 'not installed')
    }
  } else if (process.platform === 'linux') {
    try {
      const r = execSync('systemctl --user is-active claudeclaw.service 2>/dev/null', { encoding: 'utf-8' })
      if (r.trim() === 'active') ok('systemd service', 'active')
      else warn('systemd service', r.trim())
    } catch {
      warn('systemd service', 'not installed')
    }
  }

  console.log()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

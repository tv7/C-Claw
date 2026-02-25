#!/usr/bin/env tsx
import { createInterface } from 'readline'
import { execSync, spawnSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

const G = '\x1b[32m'
const Y = '\x1b[33m'
const R = '\x1b[31m'
const B = '\x1b[1m'
const D = '\x1b[2m'
const C = '\x1b[36m'
const RESET = '\x1b[0m'

const ok   = (msg: string) => console.log(`${G}✓${RESET} ${msg}`)
const warn = (msg: string) => console.log(`${Y}⚠${RESET}  ${msg}`)
const fail = (msg: string) => console.log(`${R}✗${RESET} ${msg}`)
const info = (msg: string) => console.log(`${C}→${RESET} ${msg}`)
const header = (msg: string) => console.log(`\n${B}${msg}${RESET}`)
const dim  = (msg: string) => console.log(`${D}  ${msg}${RESET}`)

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask(question: string, defaultValue = ''): Promise<string> {
  const hint = defaultValue ? ` ${D}[${defaultValue}]${RESET}` : ''
  return new Promise(resolve => {
    rl.question(`${question}${hint} `, answer => {
      const t = answer.trim()
      resolve(t === '' ? defaultValue : t)
    })
  })
}

function askSecret(question: string, current = ''): Promise<string> {
  const hint = current ? ` ${D}[keep existing — press Enter]${RESET}` : ` ${D}[press Enter to skip]${RESET}`
  return new Promise(resolve => {
    rl.question(`${question}${hint}\n  > `, answer => {
      const t = answer.trim()
      resolve(t === '' ? current : t)
    })
  })
}

function askYesNo(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  return new Promise(resolve => {
    rl.question(`${question} [${hint}] `, answer => {
      const t = answer.trim().toLowerCase()
      if (t === '') resolve(defaultYes)
      else resolve(t === 'y' || t === 'yes')
    })
  })
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
  } catch { return null }
}

function readExistingEnv(): Record<string, string> {
  const p = path.join(PROJECT_ROOT, '.env')
  if (!existsSync(p)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (k) out[k] = v
  }
  return out
}

function writeEnv(cfg: Record<string, string>): void {
  const lines = [
    '# ClaudeClaw configuration',
    '',
    '# --- Telegram ---',
    `TELEGRAM_BOT_TOKEN=${cfg['TELEGRAM_BOT_TOKEN'] ?? ''}`,
    `ALLOWED_CHAT_ID=${cfg['ALLOWED_CHAT_ID'] ?? ''}`,
    '',
    '# --- Voice ---',
    `GROQ_API_KEY=${cfg['GROQ_API_KEY'] ?? ''}`,
    `ELEVENLABS_API_KEY=${cfg['ELEVENLABS_API_KEY'] ?? ''}`,
    `ELEVENLABS_VOICE_ID=${cfg['ELEVENLABS_VOICE_ID'] ?? ''}`,
    '',
    '# --- Video ---',
    `GOOGLE_API_KEY=${cfg['GOOGLE_API_KEY'] ?? ''}`,
    '',
    `MULTIUSER=${cfg['MULTIUSER'] ?? 'false'}`,
  ]
  writeFileSync(path.join(PROJECT_ROOT, '.env'), lines.join('\n') + '\n', 'utf8')
}

function installMacService(): void {
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents')
  const plistPath = path.join(plistDir, 'com.claudeclaw.app.plist')
  mkdirSync(plistDir, { recursive: true })
  const nodeExe = process.execPath
  const entryPoint = path.join(PROJECT_ROOT, 'dist', 'index.js')
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claudeclaw.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeExe}</string>
    <string>${entryPoint}</string>
  </array>
  <key>WorkingDirectory</key><string>${PROJECT_ROOT}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/tmp/claudeclaw.log</string>
  <key>StandardErrorPath</key><string>/tmp/claudeclaw.log</string>
</dict>
</plist>`
  writeFileSync(plistPath, plist, 'utf8')
  tryExec(`launchctl unload "${plistPath}"`)
  tryExec(`launchctl load "${plistPath}"`)
  ok('launchd service installed')
  dim(`Logs: /tmp/claudeclaw.log`)
  dim(`Stop: launchctl unload ~/Library/LaunchAgents/com.claudeclaw.app.plist`)
}

function installLinuxService(): void {
  const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user')
  mkdirSync(serviceDir, { recursive: true })
  const nodeExe = process.execPath
  const entryPoint = path.join(PROJECT_ROOT, 'dist', 'index.js')
  const unit = `[Unit]
Description=ClaudeClaw AI Assistant
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${nodeExe} ${entryPoint}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`
  writeFileSync(path.join(serviceDir, 'claudeclaw.service'), unit, 'utf8')
  tryExec('systemctl --user daemon-reload')
  tryExec('systemctl --user enable claudeclaw')
  tryExec('systemctl --user start claudeclaw')
  ok('systemd service installed')
  dim(`Logs: journalctl --user -u claudeclaw -f`)
  dim(`Stop: systemctl --user stop claudeclaw`)
}

function showWindowsPm2(): void {
  info('Windows — use PM2 to run as a background service:')
  console.log()
  console.log(`  npm install -g pm2`)
  console.log(`  pm2 start "${path.join(PROJECT_ROOT, 'dist', 'index.js')}" --name claudeclaw`)
  console.log(`  pm2 startup`)
  console.log(`  pm2 save`)
  console.log()
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  try {
    const banner = readFileSync(path.join(PROJECT_ROOT, 'banner.txt'), 'utf8')
    console.log(banner)
  } catch {
    console.log(`${B}=== ClaudeClaw Setup ===${RESET}\n`)
  }

  const todos: string[] = []
  const cfg = readExistingEnv()

  // ---------------------------------------------------------------------------
  // Step 1 — Requirements
  // ---------------------------------------------------------------------------

  header('1. Requirements check')

  const nodeVer = process.version
  const major = parseInt(nodeVer.slice(1).split('.')[0], 10)
  if (major >= 22) {
    ok(`Node.js ${nodeVer}`)
  } else if (major >= 20) {
    warn(`Node.js ${nodeVer} — v22.5.0+ recommended for built-in SQLite`)
  } else {
    fail(`Node.js ${nodeVer} is too old (need v20+)`)
    warn('Download a newer version from nodejs.org, then re-run setup')
  }

  const claudeVer = tryExec('claude --version')
  if (claudeVer) {
    ok(`Claude CLI: ${claudeVer}`)
  } else {
    fail('claude CLI not found')
    warn('Install from https://claude.ai/code and run "claude login" first')
    todos.push('Install Claude CLI and run "claude login"')
  }

  // ---------------------------------------------------------------------------
  // Step 2 — Build
  // ---------------------------------------------------------------------------

  header('2. Build')

  const wantBuild = await askYesNo('Build the project now? (required for npm start)', true)
  if (wantBuild) {
    info('Running npm run build...')
    const r = spawnSync('npm', ['run', 'build'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      shell: true,
      stdio: ['inherit', 'inherit', 'inherit'],
    })
    if (r.status === 0) {
      ok('Build succeeded')
    } else {
      fail('Build failed — fix errors above then re-run setup or run npm run build manually')
      todos.push('Fix build errors: npm run build')
    }
  } else {
    warn('Skipped — run "npm run build" before starting the bot')
    todos.push('Build the project: npm run build')
  }

  // ---------------------------------------------------------------------------
  // Step 3 — Telegram
  // ---------------------------------------------------------------------------

  header('3. Telegram bot token')
  dim('Get one from @BotFather: open Telegram → search @BotFather → /newbot')

  cfg['TELEGRAM_BOT_TOKEN'] = await askSecret('Bot token:', cfg['TELEGRAM_BOT_TOKEN'] ?? '')

  if (!cfg['TELEGRAM_BOT_TOKEN']) {
    warn('No token entered — bot cannot start without it')
    todos.push('Add TELEGRAM_BOT_TOKEN to .env')
  }

  // ---------------------------------------------------------------------------
  // Step 4 — Voice
  // ---------------------------------------------------------------------------

  header('4. Voice transcription (Groq Whisper)')
  dim('Free tier at console.groq.com — lets you send voice notes to your bot')

  if (await askYesNo('Configure Groq STT?', !!cfg['GROQ_API_KEY'])) {
    cfg['GROQ_API_KEY'] = await askSecret('Groq API key:', cfg['GROQ_API_KEY'] ?? '')
    if (!cfg['GROQ_API_KEY']) todos.push('Add GROQ_API_KEY to .env for voice transcription')
  } else {
    cfg['GROQ_API_KEY'] = cfg['GROQ_API_KEY'] ?? ''
    warn('Skipped — voice notes will not be transcribed')
  }

  console.log()
  dim('ElevenLabs TTS — free tier at elevenlabs.io — bot replies with your voice')

  if (await askYesNo('Configure ElevenLabs TTS?', !!cfg['ELEVENLABS_API_KEY'])) {
    cfg['ELEVENLABS_API_KEY'] = await askSecret('ElevenLabs API key:', cfg['ELEVENLABS_API_KEY'] ?? '')
    cfg['ELEVENLABS_VOICE_ID'] = await ask('ElevenLabs voice ID:', cfg['ELEVENLABS_VOICE_ID'] ?? '')
    if (!cfg['ELEVENLABS_API_KEY']) todos.push('Add ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID to .env for voice replies')
  } else {
    cfg['ELEVENLABS_API_KEY'] = cfg['ELEVENLABS_API_KEY'] ?? ''
    cfg['ELEVENLABS_VOICE_ID'] = cfg['ELEVENLABS_VOICE_ID'] ?? ''
    warn('Skipped — bot will reply in text only')
  }

  // ---------------------------------------------------------------------------
  // Step 5 — Video
  // ---------------------------------------------------------------------------

  header('5. Video analysis (Google Gemini)')
  dim('Free tier at aistudio.google.com — lets bot analyze videos you send')

  if (await askYesNo('Configure Gemini video analysis?', !!cfg['GOOGLE_API_KEY'])) {
    cfg['GOOGLE_API_KEY'] = await askSecret('Google API key:', cfg['GOOGLE_API_KEY'] ?? '')
    if (!cfg['GOOGLE_API_KEY']) todos.push('Add GOOGLE_API_KEY to .env for video analysis')
  } else {
    cfg['GOOGLE_API_KEY'] = cfg['GOOGLE_API_KEY'] ?? ''
    warn('Skipped')
  }

  // Write .env before opening editor
  cfg['MULTIUSER'] = cfg['MULTIUSER'] ?? 'false'
  writeEnv(cfg)
  ok('.env saved')

  // ---------------------------------------------------------------------------
  // Step 6 — Personalize CLAUDE.md
  // ---------------------------------------------------------------------------

  header('6. Personalize CLAUDE.md')
  dim('This is your assistant\'s system prompt — fill in your name, projects, preferences')

  if (await askYesNo('Open CLAUDE.md in your editor?', true)) {
    const editor = process.env.EDITOR ?? process.env.VISUAL ?? (process.platform === 'win32' ? 'notepad' : 'nano')
    spawnSync(editor, [path.join(PROJECT_ROOT, 'CLAUDE.md')], { stdio: 'inherit', shell: true })
    ok('CLAUDE.md saved')
  } else {
    warn('Skipped — edit CLAUDE.md later to personalize your assistant')
    todos.push(`Personalize CLAUDE.md: ${path.join(PROJECT_ROOT, 'CLAUDE.md')}`)
  }

  // ---------------------------------------------------------------------------
  // Step 7 — Chat ID
  // ---------------------------------------------------------------------------

  header('7. Your Telegram chat ID')
  dim('Start the bot, send /chatid, then paste the number here')
  dim('This locks the bot so only you can use it')

  if (cfg['ALLOWED_CHAT_ID']) {
    ok(`Already configured: ${cfg['ALLOWED_CHAT_ID']}`)
    if (await askYesNo('Change it?', false)) {
      const id = await ask('New chat ID (Enter to keep current):', cfg['ALLOWED_CHAT_ID'])
      cfg['ALLOWED_CHAT_ID'] = id
    }
  } else {
    const id = await ask('Chat ID (Enter to skip — bot will accept anyone until set):', '')
    if (id) {
      cfg['ALLOWED_CHAT_ID'] = id
      ok(`Chat ID saved: ${id}`)
    } else {
      warn('Skipped — set ALLOWED_CHAT_ID in .env before sharing the bot token')
      todos.push('Set ALLOWED_CHAT_ID in .env (send /chatid to your bot)')
    }
  }

  writeEnv(cfg)

  // ---------------------------------------------------------------------------
  // Step 8 — Background service
  // ---------------------------------------------------------------------------

  header('8. Background service (auto-start on login)')

  if (await askYesNo('Install as a background service?', true)) {
    const platform = process.platform
    if (platform === 'darwin') {
      installMacService()
    } else if (platform === 'linux') {
      installLinuxService()
    } else {
      showWindowsPm2()
      todos.push('Run PM2 commands above to install the background service')
    }
  } else {
    warn('Skipped — start manually with: npm start')
    todos.push('Start the bot manually: npm start')
  }

  // ---------------------------------------------------------------------------
  // Done
  // ---------------------------------------------------------------------------

  header('Done')
  console.log()

  if (todos.length > 0) {
    console.log(`${B}Still to do:${RESET}`)
    for (const t of todos) {
      console.log(`  ${Y}•${RESET} ${t}`)
    }
    console.log()
  }

  console.log(`Check status: ${B}npm run status${RESET}`)
  console.log()

  rl.close()
}

main().catch(err => {
  console.error(`\n${R}Error:${RESET}`, err instanceof Error ? err.message : err)
  rl.close()
  process.exit(1)
})

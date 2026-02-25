#!/usr/bin/env tsx
/**
 * ClaudeClaw Interactive Setup Wizard
 * Collects configuration, writes .env, installs background service
 */
import { execSync, spawnSync } from 'child_process'
import { createInterface } from 'readline'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

// ── Colors ────────────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
}

const ok = (msg: string) => console.log(`${C.green}✓${C.reset} ${msg}`)
const warn = (msg: string) => console.log(`${C.yellow}⚠${C.reset} ${msg}`)
const err = (msg: string) => console.log(`${C.red}✗${C.reset} ${msg}`)
const info = (msg: string) => console.log(`${C.cyan}→${C.reset} ${msg}`)
const header = (msg: string) => console.log(`\n${C.bold}${msg}${C.reset}`)

// ── Banner ────────────────────────────────────────────────────────────────────
function showBanner() {
  try {
    const banner = readFileSync(path.join(PROJECT_ROOT, 'banner.txt'), 'utf-8')
    console.log(C.cyan + banner + C.reset)
  } catch {
    console.log(`${C.bold}ClaudeClaw Setup Wizard${C.reset}\n`)
  }
}

// ── Readline helper ───────────────────────────────────────────────────────────
function createRl() {
  return createInterface({ input: process.stdin, output: process.stdout })
}

function prompt(rl: ReturnType<typeof createRl>, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

// ── Checks ────────────────────────────────────────────────────────────────────
function checkNode(): boolean {
  const [major] = process.versions.node.split('.').map(Number)
  if (major >= 20) { ok(`Node.js ${process.versions.node}`); return true }
  err(`Node.js ${process.versions.node} — need >=20`); return false
}

function checkClaude(): boolean {
  try {
    const result = spawnSync('claude', ['--version'], { encoding: 'utf-8' })
    if (result.status === 0) {
      ok(`claude CLI: ${result.stdout.trim()}`)
      return true
    }
  } catch {}
  err('claude CLI not found. Install from https://claude.ai/code')
  return false
}

// ── Build ─────────────────────────────────────────────────────────────────────
function buildProject(): boolean {
  info('Building project...')
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    stdio: 'inherit',
  })
  if (result.status === 0) { ok('Build successful'); return true }
  err('Build failed — fix TypeScript errors and re-run setup')
  return false
}

// ── Platform ──────────────────────────────────────────────────────────────────
function detectPlatform(): 'macos' | 'linux' | 'windows' {
  if (process.platform === 'darwin') return 'macos'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

// ── Service install ───────────────────────────────────────────────────────────
function installMacOsService(envPath: string): void {
  const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.claudeclaw.app.plist')
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.claudeclaw.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>${path.join(PROJECT_ROOT, 'dist', 'index.js')}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${os.homedir()}</string>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>/tmp/claudeclaw.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/claudeclaw.err.log</string>
</dict>
</plist>`

  mkdirSync(path.dirname(plistPath), { recursive: true })
  writeFileSync(plistPath, plist)
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null || true`)
    execSync(`launchctl load "${plistPath}"`)
    ok(`macOS launchd service installed: ${plistPath}`)
    ok('ClaudeClaw will start automatically on login')
  } catch (e) {
    warn(`Service install failed: ${String(e)}`)
    info(`You can manually load it: launchctl load "${plistPath}"`)
  }
}

function installLinuxService(): void {
  const serviceDir = path.join(os.homedir(), '.config', 'systemd', 'user')
  const servicePath = path.join(serviceDir, 'claudeclaw.service')
  const nodePath = process.execPath
  const service = `[Unit]
Description=ClaudeClaw — Personal AI Assistant
After=network.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${nodePath} ${path.join(PROJECT_ROOT, 'dist', 'index.js')}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`
  mkdirSync(serviceDir, { recursive: true })
  writeFileSync(servicePath, service)
  try {
    execSync('systemctl --user daemon-reload')
    execSync('systemctl --user enable claudeclaw.service')
    execSync('systemctl --user start claudeclaw.service')
    ok('systemd service installed and started')
    ok('ClaudeClaw will start automatically on login')
    info('Logs: journalctl --user -u claudeclaw -f')
  } catch (e) {
    warn(`systemd setup failed: ${String(e)}`)
    info(`Service file written to: ${servicePath}`)
    info('Run: systemctl --user daemon-reload && systemctl --user enable claudeclaw')
  }
}

function installWindowsService(): void {
  warn('Windows: manual service setup required')
  info('Install PM2: npm install -g pm2')
  info(`Start: pm2 start ${path.join(PROJECT_ROOT, 'dist', 'index.js')} --name claudeclaw`)
  info('Auto-start: pm2 startup && pm2 save')
}

// ── Main wizard ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  showBanner()
  console.log(`${C.bold}ClaudeClaw Setup Wizard${C.reset}`)
  console.log('This wizard will configure your bot and install the background service.\n')

  header('1. Checking requirements...')
  const nodeOk = checkNode()
  const claudeOk = checkClaude()
  if (!nodeOk) { process.exit(1) }
  if (!claudeOk) { warn('Continuing without claude CLI check...') }

  const rl = createRl()

  header('2. Telegram configuration')
  console.log('Get your bot token from @BotFather on Telegram.')
  console.log('1. Open Telegram, search for @BotFather')
  console.log('2. Send /newbot and follow the prompts')
  console.log('3. Copy the token it gives you\n')

  const botToken = await prompt(rl, `${C.cyan}Bot token${C.reset}: `)
  if (!botToken.includes(':')) {
    err('Invalid bot token format. Should look like: 1234567890:ABCdef...')
    rl.close()
    process.exit(1)
  }

  header('3. Voice features (optional)')
  info('Groq STT: free tier at console.groq.com')
  info('ElevenLabs TTS: free tier at elevenlabs.io')

  const groqKey = await prompt(rl, `${C.cyan}Groq API key${C.reset} (press Enter to skip): `)
  let elevenKey = ''
  let elevenVoice = ''
  if (groqKey) {
    ok('Groq STT configured')
    elevenKey = await prompt(rl, `${C.cyan}ElevenLabs API key${C.reset} (press Enter to skip): `)
    if (elevenKey) {
      elevenVoice = await prompt(rl, `${C.cyan}ElevenLabs voice ID${C.reset}: `)
    }
  }

  header('4. Video analysis (optional)')
  info('Google Gemini: free tier at aistudio.google.com')
  const googleKey = await prompt(rl, `${C.cyan}Google API key${C.reset} (press Enter to skip): `)

  header('5. Building project...')
  const built = buildProject()
  if (!built) { rl.close(); process.exit(1) }

  header('6. Writing .env...')
  const envLines = [
    '# ClaudeClaw Configuration',
    `TELEGRAM_BOT_TOKEN=${botToken}`,
    `ALLOWED_CHAT_ID=`,
    `LOG_LEVEL=info`,
    '',
  ]
  if (groqKey) envLines.push(`GROQ_API_KEY=${groqKey}`)
  if (elevenKey) {
    envLines.push(`ELEVENLABS_API_KEY=${elevenKey}`)
    envLines.push(`ELEVENLABS_VOICE_ID=${elevenVoice}`)
  }
  if (googleKey) envLines.push(`GOOGLE_API_KEY=${googleKey}`)

  const envPath = path.join(PROJECT_ROOT, '.env')
  writeFileSync(envPath, envLines.join('\n') + '\n')
  ok(`.env written to ${envPath}`)

  header('7. Personalizing CLAUDE.md...')
  info('Opening CLAUDE.md in your editor — fill in your name and preferences.')
  const editor = process.env['EDITOR'] ?? (process.platform === 'win32' ? 'notepad' : 'nano')
  const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md')
  try {
    spawnSync(editor, [claudeMdPath], { stdio: 'inherit' })
    ok('CLAUDE.md saved')
  } catch {
    warn(`Could not open editor. Edit ${claudeMdPath} manually.`)
  }

  header('8. Installing background service...')
  const platform = detectPlatform()
  const installService = await prompt(rl, `Install as background service (auto-start on boot)? [Y/n]: `)
  if (installService.toLowerCase() !== 'n') {
    if (platform === 'macos') installMacOsService(envPath)
    else if (platform === 'linux') installLinuxService()
    else installWindowsService()
  }

  header('9. Getting your chat ID...')
  console.log('\nNow start the bot and send /chatid to it on Telegram.')
  console.log('The bot will reply with your chat ID.\n')

  const chatId = await prompt(rl, `${C.cyan}Your chat ID${C.reset} (from /chatid): `)
  if (chatId.trim()) {
    const envContent = readFileSync(envPath, 'utf-8')
    writeFileSync(envPath, envContent.replace('ALLOWED_CHAT_ID=', `ALLOWED_CHAT_ID=${chatId.trim()}`))
    ok('Chat ID saved to .env')
  }

  rl.close()

  header('Setup complete!')
  console.log(`\n${C.green}${C.bold}ClaudeClaw is configured!${C.reset}\n`)
  console.log('Next steps:')
  console.log(`  ${C.cyan}npm run start${C.reset}  — Start the bot`)
  console.log(`  ${C.cyan}npm run dev${C.reset}    — Start in dev mode (no build needed)`)
  console.log(`  ${C.cyan}npm run status${C.reset} — Check bot health\n`)
  console.log('Send any message to your bot on Telegram to get started.\n')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})

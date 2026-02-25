# ClaudeClaw

```
 ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
██║     ██║     ███████║██║   ██║██║  ██║█████╗
██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝
╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
 ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝╚══════╝
```

**Your Claude Code, in your pocket.** Send a message on Telegram — it runs the real `claude` CLI on your machine, with all your skills, memory, and tools — and sends the result back.

## One-line install

**Mac / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/tv7/C-Claw/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/tv7/C-Claw/main/install.ps1 | iex
```

**Docker (any OS with Docker):**
```bash
git clone https://github.com/tv7/C-Claw.git && cd C-Claw && cp .env.example .env && docker compose up -d
```

## What you need before installing

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **Claude Code CLI** — [claude.ai/code](https://claude.ai/code), logged in (`claude` works in your terminal)
- **A Telegram account** — takes 2 min to create a bot via @BotFather

## What it does

- Talk to Claude Code from your phone, anywhere
- Voice notes in → transcribed and acted on (Groq Whisper)
- Voice replies out (ElevenLabs)
- Analyze photos and documents you forward
- Schedule tasks with cron — daily briefings, autonomous agents
- WhatsApp bridge — read and reply to WhatsApp from inside your bot
- Persistent memory that decays and stays relevant
- Installs as a background service — starts on boot

## Manual setup

```bash
git clone https://github.com/tv7/C-Claw.git
cd C-Claw
npm install --legacy-peer-deps
npm run setup       # interactive wizard: gets bot token, installs service
npm run start       # start the bot
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run setup` | Interactive setup wizard |
| `npm run start` | Start the bot (production) |
| `npm run dev` | Start in dev mode (no build) |
| `npm run status` | Health check |
| `npm run build` | Compile TypeScript |
| `npm test` | Run tests |

## Telegram bot commands

| Command | Description |
|---------|-------------|
| `/chatid` | Show your chat ID |
| `/newchat` | Start a fresh conversation |
| `/memory` | Show recent memories |
| `/voice` | Toggle voice replies on/off |
| `/schedule` | Manage scheduled tasks |
| `/wa` | WhatsApp bridge |

## Features

### Voice
Send a voice note → Groq Whisper transcribes it → Claude acts on it → optionally replies with ElevenLabs audio.

Set `GROQ_API_KEY` (free at [console.groq.com](https://console.groq.com)) for STT.
Set `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` for TTS.

### Memory
Dual-sector salience model. Semantic memories (things about you) persist longer than episodic ones. FTS5 full-text search finds relevant context before each message. Decays daily, auto-deletes below threshold.

### Scheduler
```bash
node dist/schedule-cli.js create "Summarize my emails" "0 9 * * *" YOUR_CHAT_ID
node dist/schedule-cli.js list
```

### WhatsApp bridge
First run: scan QR code in terminal. After that: `/wa` in Telegram shows recent chats.

## Environment variables

See `.env.example` for all options. Required:
- `TELEGRAM_BOT_TOKEN` — from @BotFather
- `ALLOWED_CHAT_ID` — your chat ID (bot tells you on first run)

## Architecture

```
Telegram
   ↓
Media handler (voice/photo/doc/video download)
   ↓
Memory context builder (FTS5 + salience decay)
   ↓
Claude Code SDK (spawns real `claude` CLI subprocess)
   ↓  ← sessions persisted in SQLite per chat
Response formatter + sender
   ↓
Optional: ElevenLabs TTS before sending
```

## License

MIT

import { fileURLToPath } from 'url'
import path from 'path'
import { readEnvFile } from './env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const PROJECT_ROOT = path.resolve(__dirname, '..')
export const STORE_DIR = path.join(PROJECT_ROOT, 'store')

// Telegram
export const TELEGRAM_BOT_TOKEN = readEnvFile()['TELEGRAM_BOT_TOKEN'] ?? ''
export const ALLOWED_CHAT_ID = readEnvFile()['ALLOWED_CHAT_ID'] ?? ''
export const ALLOWED_CHAT_IDS: string[] = (() => {
  const multi = readEnvFile()['ALLOWED_CHAT_IDS'] ?? ''
  if (multi) return multi.split(',').map((s: string) => s.trim()).filter(Boolean)
  const single = readEnvFile()['ALLOWED_CHAT_ID'] ?? ''
  return single ? [single] : []
})()

// Voice
export const GROQ_API_KEY = readEnvFile()['GROQ_API_KEY'] ?? ''
export const ELEVENLABS_API_KEY = readEnvFile()['ELEVENLABS_API_KEY'] ?? ''
export const ELEVENLABS_VOICE_ID = readEnvFile()['ELEVENLABS_VOICE_ID'] ?? ''

// Video
export const GOOGLE_API_KEY = readEnvFile()['GOOGLE_API_KEY'] ?? ''

// Limits
export const MAX_MESSAGE_LENGTH = 4096
export const TYPING_REFRESH_MS = 4000

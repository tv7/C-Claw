import { fileURLToPath } from 'url'
import path from 'path'
import { readEnvFile } from './env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const PROJECT_ROOT = path.resolve(__dirname, '..')
export const STORE_DIR = path.join(PROJECT_ROOT, 'store')

const env = readEnvFile()

export const TELEGRAM_BOT_TOKEN: string = env['TELEGRAM_BOT_TOKEN'] ?? ''

function parseAllowedChatIds(): string[] {
  const multi = env['ALLOWED_CHAT_IDS']
  if (multi) {
    return multi
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
  }

  const single = env['ALLOWED_CHAT_ID']
  if (single && single.trim().length > 0) {
    return [single.trim()]
  }

  return []
}

export const ALLOWED_CHAT_IDS: string[] = parseAllowedChatIds()

export const GROQ_API_KEY: string = env['GROQ_API_KEY'] ?? ''
export const ELEVENLABS_API_KEY: string = env['ELEVENLABS_API_KEY'] ?? ''
export const ELEVENLABS_VOICE_ID: string = env['ELEVENLABS_VOICE_ID'] ?? ''
export const GOOGLE_API_KEY: string = env['GOOGLE_API_KEY'] ?? ''

export const MAX_MESSAGE_LENGTH = 4096
export const TYPING_REFRESH_MS = 4000

export const MULTIUSER: boolean = env['MULTIUSER']?.toLowerCase() === 'true'

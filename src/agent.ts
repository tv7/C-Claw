import { query } from '@anthropic-ai/claude-agent-sdk'
import { fileURLToPath } from 'url'
import path from 'path'
import { readEnvFile } from './env.js'
import { logger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

export interface AgentResult {
  text: string | null
  newSessionId?: string
}

/**
 * Run the Claude Code agent with session resumption.
 * bypassPermissions is required for unattended bot operation.
 */
export async function runAgent(
  message: string,
  sessionId?: string,
  onTyping?: () => void
): Promise<AgentResult> {
  const env = readEnvFile()

  let resultText: string | null = null
  let newSessionId: string | undefined

  // Typing indicator refresh
  let typingInterval: ReturnType<typeof setInterval> | null = null
  if (onTyping) {
    typingInterval = setInterval(onTyping, 4000)
  }

  try {
    const agentOptions: Parameters<typeof query>[0] = {
      prompt: message,
      options: {
        cwd: PROJECT_ROOT,
        permissionMode: 'bypassPermissions',
        settingSources: ['project', 'user'],
      },
    }

    if (sessionId) {
      (agentOptions.options as Record<string, unknown>).resume = sessionId
    }

    const stream = query(agentOptions)

    for await (const event of stream) {
      if (event.type === 'system' && (event as Record<string, unknown>).subtype === 'init') {
        const initEvent = event as Record<string, unknown>
        if (initEvent.session_id) {
          newSessionId = initEvent.session_id as string
        }
      }
      if (event.type === 'result') {
        const resultEvent = event as Record<string, unknown>
        if (resultEvent.result) {
          resultText = String(resultEvent.result)
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'runAgent error')
    throw err
  } finally {
    if (typingInterval) clearInterval(typingInterval)
  }

  return { text: resultText, newSessionId }
}

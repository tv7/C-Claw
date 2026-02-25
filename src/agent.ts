import { query } from '@anthropic-ai/claude-agent-sdk'
import { fileURLToPath } from 'url'
import path from 'path'
import { logger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

export interface AgentResult {
  text: string | null
  newSessionId?: string
}

export async function runAgent(
  message: string,
  sessionId?: string,
  onTyping?: () => void
): Promise<AgentResult> {
  let text: string | null = null
  let newSessionId: string | undefined
  let typingInterval: ReturnType<typeof setInterval> | null = null

  if (onTyping) {
    onTyping()
    typingInterval = setInterval(() => {
      onTyping()
    }, 4000)
  }

  try {
    const options: Record<string, unknown> = {
      cwd: PROJECT_ROOT,
      permissionMode: 'bypassPermissions',
      settingSources: ['project', 'user'],
    }

    if (sessionId) {
      options.resume = sessionId
    }

    const stream = query({
      prompt: message,
      options,
    })

    for await (const event of stream) {
      if (
        event.type === 'system' &&
        (event as { type: string; subtype?: string; session_id?: string }).subtype === 'init'
      ) {
        const initEvent = event as { type: string; subtype: string; session_id?: string }
        if (initEvent.session_id) {
          newSessionId = initEvent.session_id
          logger.debug({ sessionId: newSessionId }, 'agent session initialized')
        }
      } else if (event.type === 'result') {
        const resultEvent = event as { type: string; result?: string }
        if (resultEvent.result != null) {
          text = resultEvent.result
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'agent query failed')
    throw err
  } finally {
    if (typingInterval !== null) {
      clearInterval(typingInterval)
    }
  }

  return { text, newSessionId }
}

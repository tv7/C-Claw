import { insertMemory, searchMemoriesFts, getRecentMemories, touchMemory, decayMemories as dbDecay } from './db.js'
import { logger } from './logger.js'

const SEMANTIC_PATTERN = /\b(my|i am|i'm|i prefer|remember|always|never|i like|i hate|i use|i work)\b/i

/**
 * Build a memory context string to prepend to user messages.
 * Searches FTS5 index and recent memories, deduplicates, and returns formatted context.
 */
export async function buildMemoryContext(chatId: string, userMessage: string): Promise<string> {
  try {
    // Sanitize query for FTS5 — strip non-alphanumeric, add * for prefix search
    const sanitized = userMessage
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 5)
      .join(' OR ')

    const ftsResults = sanitized
      ? searchMemoriesFts(chatId, sanitized + '*', 3)
      : []

    const recentResults = getRecentMemories(chatId, 5)

    // Deduplicate by id
    const seen = new Set<number>()
    const combined = [...ftsResults, ...recentResults].filter(m => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })

    if (combined.length === 0) return ''

    // Touch each memory to reinforce salience
    for (const m of combined) {
      touchMemory(m.id)
    }

    const lines = combined.map(m => `- ${m.content} (${m.sector})`)
    return `[Memory context]\n${lines.join('\n')}`
  } catch (err) {
    logger.warn({ err }, 'buildMemoryContext error — skipping')
    return ''
  }
}

/**
 * Save a conversation turn to the memory store.
 * Classifies as semantic or episodic based on content.
 */
export async function saveConversationTurn(
  chatId: string,
  userMsg: string,
  assistantMsg: string
): Promise<void> {
  if (userMsg.length <= 20 || userMsg.startsWith('/')) return

  try {
    const sector = SEMANTIC_PATTERN.test(userMsg) ? 'semantic' : 'episodic'
    const content = `User: ${userMsg.slice(0, 200)}\nAssistant: ${assistantMsg.slice(0, 200)}`
    insertMemory(chatId, content, sector)
  } catch (err) {
    logger.warn({ err }, 'saveConversationTurn error')
  }
}

/**
 * Run the salience decay sweep. Call this daily.
 */
export function runDecaySweep(): void {
  try {
    dbDecay()
    logger.debug('Memory decay sweep complete')
  } catch (err) {
    logger.warn({ err }, 'runDecaySweep error')
  }
}

import {
  insertMemory,
  searchMemoriesFts,
  getRecentMemories,
  touchMemory,
  decayMemories as dbDecay,
} from './db.js'
import { logger } from './logger.js'

const SEMANTIC_TRIGGERS =
  /\b(my|i am|i'm|i prefer|remember|always|never|i like|i hate|i use|i work|i need|i want)\b/i

export async function buildMemoryContext(
  chatId: string,
  userMessage: string
): Promise<string> {
  // Sanitize query: strip non-alphanum, split words >2 chars, take first 5, join with ' OR ', add '*'
  const sanitized = userMessage.replace(/[^a-zA-Z0-9\s]/g, ' ')
  const words = sanitized
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 5)

  const memories: Array<{ id: number; content: string; sector: string }> = []

  if (words.length > 0) {
    const ftsQuery = words.map(w => `${w}*`).join(' OR ')
    try {
      const ftsResults = searchMemoriesFts(chatId, ftsQuery, 3)
      memories.push(...ftsResults)
    } catch (err) {
      logger.warn({ err }, 'FTS search failed, skipping')
    }
  }

  const recentResults = getRecentMemories(chatId, 5)

  // Deduplicate by id
  const seen = new Set<number>()
  for (const m of memories) seen.add(m.id)
  for (const m of recentResults) {
    if (!seen.has(m.id)) {
      seen.add(m.id)
      memories.push(m)
    }
  }

  if (memories.length === 0) return ''

  // Touch each to reinforce salience
  for (const m of memories) {
    touchMemory(m.id)
  }

  const lines = memories
    .map(m => `- ${m.content} (${m.sector})`)
    .join('\n')

  return `[Memory context]\n${lines}`
}

export async function saveConversationTurn(
  chatId: string,
  userMsg: string,
  assistantMsg: string
): Promise<void> {
  if (userMsg.length <= 20 || userMsg.startsWith('/')) return

  const sector: 'semantic' | 'episodic' = SEMANTIC_TRIGGERS.test(userMsg)
    ? 'semantic'
    : 'episodic'

  const content = `User: ${userMsg.slice(0, 200)}\nAssistant: ${assistantMsg.slice(0, 200)}`

  insertMemory(chatId, content, sector)
}

export function runDecaySweep(): void {
  try {
    dbDecay()
    logger.info('memory decay sweep completed')
  } catch (err) {
    logger.error({ err }, 'memory decay sweep failed')
  }
}

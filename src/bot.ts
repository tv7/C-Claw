import { Bot, Context, InputFile } from 'grammy'
import { writeFileSync } from 'fs'
import path from 'path'
import { TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, MAX_MESSAGE_LENGTH, TYPING_REFRESH_MS } from './config.js'
import { getSession, setSession, clearSession, getMemoriesForChat } from './db.js'
import { runAgent } from './agent.js'
import { buildMemoryContext, saveConversationTurn, runDecaySweep } from './memory.js'
import { transcribeAudio, synthesizeSpeech, voiceCapabilities } from './voice.js'
import { downloadMedia, buildPhotoMessage, buildDocumentMessage, buildVideoMessage } from './media.js'
import { UPLOADS_DIR } from './media.js'
import { logger } from './logger.js'

// In-memory set of chat IDs with voice reply enabled
const voiceModeChats = new Set<string>()

// ── Auth ─────────────────────────────────────────────────────────────────────

export function isAuthorised(chatId: number | string): boolean {
  const id = String(chatId)
  if (ALLOWED_CHAT_IDS.length === 0) return true // first-run mode
  return ALLOWED_CHAT_IDS.includes(id)
}

// ── Markdown → Telegram HTML ──────────────────────────────────────────────────

/**
 * Convert Claude's Markdown output to Telegram-compatible HTML.
 * Telegram only supports: <b>, <i>, <code>, <pre>, <s>, <a>, <u>
 */
export function formatForTelegram(text: string): string {
  // Extract and protect code blocks
  const codeBlocks: string[] = []
  let result = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const idx = codeBlocks.length
    const escaped = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    codeBlocks.push(lang ? `<pre><code class="language-${lang}">${escaped}</code></pre>` : `<pre>${escaped}</pre>`)
    return `\x00CODE${idx}\x00`
  })

  // Protect inline code
  const inlineCodes: string[] = []
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    const idx = inlineCodes.length
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    inlineCodes.push(`<code>${escaped}</code>`)
    return `\x00INLINE${idx}\x00`
  })

  // Escape HTML special chars in remaining text
  result = result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Headings → bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  result = result.replace(/__(.+?)__/g, '<b>$1</b>')

  // Italic: *text* or _text_
  result = result.replace(/\*([^*\n]+?)\*/g, '<i>$1</i>')
  result = result.replace(/_([^_\n]+?)_/g, '<i>$1</i>')

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<s>$1</s>')

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // Checkboxes
  result = result.replace(/^- \[x\]/gmi, '☑')
  result = result.replace(/^- \[ \]/gmi, '☐')

  // Strip horizontal rules and triple-star bold/italic
  result = result.replace(/^---+$/gm, '')
  result = result.replace(/^\*\*\*+$/gm, '')

  // Restore inline codes
  result = result.replace(/\x00INLINE(\d+)\x00/g, (_m, i) => inlineCodes[Number(i)])

  // Restore code blocks
  result = result.replace(/\x00CODE(\d+)\x00/g, (_m, i) => codeBlocks[Number(i)])

  return result.trim()
}

/**
 * Split a message on newlines, keeping chunks ≤ limit chars.
 */
export function splitMessage(text: string, limit = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= limit) return [text]
  const lines = text.split('\n')
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    const addition = current ? `\n${line}` : line
    if ((current + addition).length > limit) {
      if (current) chunks.push(current)
      // If a single line exceeds limit, hard split
      if (line.length > limit) {
        for (let i = 0; i < line.length; i += limit) {
          chunks.push(line.slice(i, i + limit))
        }
        current = ''
      } else {
        current = line
      }
    } else {
      current += addition
    }
  }
  if (current) chunks.push(current)
  return chunks
}

// ── Core handler ──────────────────────────────────────────────────────────────

async function handleMessage(
  ctx: Context,
  rawText: string,
  forceVoiceReply = false
): Promise<void> {
  const chatId = String(ctx.chat?.id)
  if (!chatId || !isAuthorised(chatId)) {
    await ctx.reply('Unauthorised.')
    return
  }

  // Build memory context
  const memCtx = await buildMemoryContext(chatId, rawText)
  const fullMessage = memCtx ? `${memCtx}\n\n${rawText}` : rawText

  // Get existing session
  const sessionId = getSession(chatId)

  // Start typing indicator
  let typingActive = true
  const sendTyping = () => {
    if (typingActive) {
      ctx.api.sendChatAction(Number(chatId), 'typing').catch(() => {})
    }
  }
  sendTyping()
  const typingInterval = setInterval(sendTyping, TYPING_REFRESH_MS)

  try {
    const result = await runAgent(fullMessage, sessionId, sendTyping)
    typingActive = false
    clearInterval(typingInterval)

    // Persist session
    if (result.newSessionId) {
      setSession(chatId, result.newSessionId)
    }

    const responseText = result.text ?? '(no response)'

    // Save conversation turn to memory
    await saveConversationTurn(chatId, rawText, responseText)

    // Voice mode: TTS reply
    const caps = voiceCapabilities()
    const useVoice = caps.tts && (forceVoiceReply || voiceModeChats.has(chatId))
    if (useVoice) {
      try {
        const mp3 = await synthesizeSpeech(responseText.slice(0, 2000))
        const tmpPath = path.join(UPLOADS_DIR, `tts_${Date.now()}.mp3`)
        writeFileSync(tmpPath, mp3)
        await ctx.replyWithAudio(new InputFile(tmpPath))
        return
      } catch (err) {
        logger.warn({ err }, 'TTS failed, falling back to text')
      }
    }

    // Text reply
    const formatted = formatForTelegram(responseText)
    const chunks = splitMessage(formatted)
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: 'HTML' })
    }
  } catch (err) {
    typingActive = false
    clearInterval(typingInterval)
    logger.error({ err }, 'handleMessage error')
    await ctx.reply(`Error: ${String(err)}`)
  }
}

// ── Bot factory ───────────────────────────────────────────────────────────────

export function createBot(): Bot {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('TELEGRAM_BOT_TOKEN not set. Run `npm run setup` first.')
  }

  const bot = new Bot(TELEGRAM_BOT_TOKEN)

  // ── Commands ────────────────────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    await ctx.reply(
      '<b>ClaudeClaw</b> is running.\n\n' +
      'Send any message to talk to Claude Code.\n\n' +
      'Commands:\n' +
      '/chatid — show your chat ID\n' +
      '/newchat — start fresh conversation\n' +
      '/memory — show recent memories\n' +
      '/voice — toggle voice replies\n' +
      '/schedule — manage scheduled tasks\n' +
      '/wa — WhatsApp bridge\n' +
      '/help — show this message',
      { parse_mode: 'HTML' }
    )
  })

  bot.command('help', async (ctx) => {
    await ctx.reply(
      '<b>ClaudeClaw Commands</b>\n\n' +
      '/chatid — show your chat ID\n' +
      '/newchat — start fresh conversation\n' +
      '/forget — alias for /newchat\n' +
      '/memory — show recent memories\n' +
      '/voice — toggle voice mode on/off\n' +
      '/schedule — manage scheduled tasks\n' +
      '/wa — WhatsApp bridge\n\n' +
      'Send any text, voice note, photo, or document.',
      { parse_mode: 'HTML' }
    )
  })

  bot.command('chatid', async (ctx) => {
    await ctx.reply(`Your chat ID: <code>${ctx.chat?.id}</code>`, { parse_mode: 'HTML' })
  })

  bot.command('newchat', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    clearSession(chatId)
    await ctx.reply('Session cleared. Starting fresh.')
  })

  bot.command('forget', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    clearSession(chatId)
    await ctx.reply('Session cleared. Starting fresh.')
  })

  bot.command('memory', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    const memories = getMemoriesForChat(chatId, 10)
    if (memories.length === 0) {
      await ctx.reply('No memories stored yet.')
      return
    }
    const lines = memories.map(m =>
      `[${m.sector}] ${m.content.slice(0, 100)}${m.content.length > 100 ? '...' : ''} (salience: ${m.salience.toFixed(2)})`
    )
    await ctx.reply(`<b>Recent memories:</b>\n\n${lines.join('\n\n')}`, { parse_mode: 'HTML' })
  })

  bot.command('voice', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    const caps = voiceCapabilities()
    if (!caps.tts) {
      await ctx.reply('TTS not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in .env')
      return
    }
    if (voiceModeChats.has(chatId)) {
      voiceModeChats.delete(chatId)
      await ctx.reply('Voice mode OFF — replies will be text.')
    } else {
      voiceModeChats.add(chatId)
      await ctx.reply('Voice mode ON — replies will be audio.')
    }
  })

  bot.command('schedule', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    const text = ctx.message?.text ?? ''
    const parts = text.split(' ').slice(1)
    await handleMessage(ctx, `Manage my scheduled tasks. Command: schedule ${parts.join(' ')}`, false)
  })

  bot.command('wa', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    await handleMessage(ctx, 'Show me my recent WhatsApp chats and their unread counts.', false)
  })

  // ── Message handlers ────────────────────────────────────────────────────────

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text
    if (text.startsWith('/')) return // skip unknown commands
    await handleMessage(ctx, text)
  })

  bot.on('message:voice', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    const caps = voiceCapabilities()
    if (!caps.stt) {
      await ctx.reply('Voice transcription not configured. Set GROQ_API_KEY in .env')
      return
    }
    await ctx.api.sendChatAction(Number(chatId), 'typing')
    try {
      const fileId = ctx.message.voice.file_id
      const localPath = await downloadMedia(TELEGRAM_BOT_TOKEN, fileId, 'voice.oga')
      const transcript = await transcribeAudio(localPath)
      await handleMessage(ctx, `[Voice transcribed]: ${transcript}`, true)
    } catch (err) {
      logger.error({ err }, 'Voice handling error')
      await ctx.reply(`Voice transcription failed: ${String(err)}`)
    }
  })

  bot.on('message:photo', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    await ctx.api.sendChatAction(Number(chatId), 'upload_photo')
    try {
      const photos = ctx.message.photo
      const largest = photos[photos.length - 1]
      const localPath = await downloadMedia(TELEGRAM_BOT_TOKEN, largest.file_id, 'photo.jpg')
      const caption = ctx.message.caption
      const prompt = buildPhotoMessage(localPath, caption)
      await handleMessage(ctx, prompt)
    } catch (err) {
      logger.error({ err }, 'Photo handling error')
      await ctx.reply(`Photo handling failed: ${String(err)}`)
    }
  })

  bot.on('message:document', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    await ctx.api.sendChatAction(Number(chatId), 'upload_document')
    try {
      const doc = ctx.message.document
      const localPath = await downloadMedia(TELEGRAM_BOT_TOKEN, doc.file_id, doc.file_name)
      const caption = ctx.message.caption
      const prompt = buildDocumentMessage(localPath, doc.file_name ?? 'document', caption)
      await handleMessage(ctx, prompt)
    } catch (err) {
      logger.error({ err }, 'Document handling error')
      await ctx.reply(`Document handling failed: ${String(err)}`)
    }
  })

  bot.on('message:video', async (ctx) => {
    const chatId = String(ctx.chat?.id)
    if (!isAuthorised(chatId)) return
    await ctx.api.sendChatAction(Number(chatId), 'upload_video')
    try {
      const video = ctx.message.video
      const localPath = await downloadMedia(TELEGRAM_BOT_TOKEN, video.file_id, 'video.mp4')
      const caption = ctx.message.caption
      const prompt = buildVideoMessage(localPath, caption)
      await handleMessage(ctx, prompt)
    } catch (err) {
      logger.error({ err }, 'Video handling error')
      await ctx.reply(`Video handling failed: ${String(err)}`)
    }
  })

  // Error handler
  bot.catch((err) => {
    logger.error({ err: err.error, ctx: err.ctx?.chat?.id }, 'Bot error')
  })

  return bot
}

/**
 * Send a message to a chat (used by scheduler).
 */
export async function sendMessage(bot: Bot, chatId: string, text: string): Promise<void> {
  const formatted = formatForTelegram(text)
  const chunks = splitMessage(formatted)
  for (const chunk of chunks) {
    try {
      await bot.api.sendMessage(Number(chatId), chunk, { parse_mode: 'HTML' })
    } catch {
      // Fallback: send as plain text
      await bot.api.sendMessage(Number(chatId), chunk)
    }
  }
}

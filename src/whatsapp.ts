import { Client, LocalAuth, Message } from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import { insertWaMessage, getUnnotifiedWaMessages, markWaMessageNotified, getPendingWaOutbox, markWaOutboxSent, markWaOutboxFailed } from './db.js'
import { logger } from './logger.js'

export type WaIncomingHandler = (chatJid: string, body: string, fromName: string) => Promise<void>

let waClient: Client | null = null
let waReady = false

/**
 * Initialize WhatsApp Web client.
 * First run will display a QR code to scan.
 */
export async function initWhatsApp(onIncoming: WaIncomingHandler): Promise<void> {
  waClient = new Client({
    authStrategy: new LocalAuth({ dataPath: 'store/wa-session' }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  })

  waClient.on('qr', (qr: string) => {
    logger.info('WhatsApp QR code — scan with your phone:')
    qrcode.generate(qr, { small: true })
  })

  waClient.on('ready', () => {
    waReady = true
    logger.info('WhatsApp client ready')
    // Start outbox polling
    setInterval(flushOutbox, 5000)
  })

  waClient.on('authenticated', () => {
    logger.info('WhatsApp authenticated')
  })

  waClient.on('auth_failure', (msg: string) => {
    logger.error({ msg }, 'WhatsApp auth failure')
  })

  waClient.on('message', async (msg: Message) => {
    if (msg.fromMe) return
    const chat = await msg.getChat()
    const contact = await msg.getContact()
    const chatJid = msg.from
    const fromName = contact.pushname || contact.name || chatJid.split('@')[0]

    insertWaMessage({
      id: msg.id.id,
      chat_jid: chatJid,
      from_me: 0,
      body: msg.body,
      timestamp: Math.floor(msg.timestamp),
      notified: 0,
    })

    try {
      await onIncoming(chatJid, msg.body, fromName)
    } catch (err) {
      logger.error({ err }, 'WA incoming handler error')
    }
  })

  await waClient.initialize()
}

/**
 * Send a WhatsApp message directly.
 */
export async function sendWaMessage(chatJid: string, text: string): Promise<void> {
  if (!waClient || !waReady) {
    throw new Error('WhatsApp client not ready')
  }
  await waClient.sendMessage(chatJid, text)
}

/**
 * Flush the outbox queue — send pending messages.
 */
async function flushOutbox(): Promise<void> {
  if (!waClient || !waReady) return
  const pending = getPendingWaOutbox()
  for (const item of pending) {
    try {
      await waClient.sendMessage(item.chat_jid, item.message)
      markWaOutboxSent(item.id!)
    } catch (err) {
      logger.error({ err, id: item.id }, 'WA outbox send failed')
      markWaOutboxFailed(item.id!)
    }
  }
}

/**
 * Get list of recent chats from WhatsApp.
 */
export async function getWaChats(): Promise<Array<{ jid: string; name: string; unread: number }>> {
  if (!waClient || !waReady) return []
  const chats = await waClient.getChats()
  return chats.slice(0, 20).map(c => ({
    jid: c.id._serialized,
    name: c.name || c.id.user,
    unread: c.unreadCount,
  }))
}

export function isWaReady(): boolean {
  return waReady
}

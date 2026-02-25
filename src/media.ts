import { mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import https from 'https'
import { TELEGRAM_BOT_TOKEN, GOOGLE_API_KEY } from './config.js'
import { logger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(__dirname, '..')
export const UPLOADS_DIR = path.join(PROJECT_ROOT, 'workspace', 'uploads')

mkdirSync(UPLOADS_DIR, { recursive: true })

function httpsGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const request = (targetUrl: string) => {
      https.get(targetUrl, res => {
        if (
          res.statusCode !== undefined &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          request(res.headers.location)
          return
        }

        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      }).on('error', reject)
    }
    request(url)
  })
}

export async function downloadMedia(
  fileId: string,
  originalFilename?: string
): Promise<string> {
  // Step 1: Get file info from Telegram
  const getFileUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  const infoBuffer = await httpsGet(getFileUrl)
  const infoJson = JSON.parse(infoBuffer.toString('utf8')) as {
    ok: boolean
    result?: { file_path?: string }
  }

  if (!infoJson.ok || !infoJson.result?.file_path) {
    throw new Error(`Telegram getFile failed for file_id=${fileId}: ${infoBuffer.toString('utf8')}`)
  }

  const filePath = infoJson.result.file_path

  // Step 2: Download the actual file
  const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
  const fileBuffer = await httpsGet(downloadUrl)

  // Step 3: Sanitize filename
  const rawName = originalFilename ?? path.basename(filePath)
  const sanitized = rawName.replace(/[^a-zA-Z0-9._-]/g, '-')
  const localPath = path.join(UPLOADS_DIR, `${Date.now()}_${sanitized}`)

  // Step 4: Write to disk
  const { writeFileSync } = await import('fs')
  writeFileSync(localPath, fileBuffer)

  logger.debug({ fileId, localPath }, 'media downloaded')

  return localPath
}

export function buildPhotoMessage(localPath: string, caption?: string): string {
  const captionPart = caption ? `Caption: ${caption}` : ''
  return `I've received a photo at ${localPath}. ${captionPart} Please analyze it.`.trim()
}

export function buildDocumentMessage(
  localPath: string,
  filename: string,
  caption?: string
): string {
  const captionPart = caption ? `Caption: ${caption}` : ''
  return `I've received a document '${filename}' at ${localPath}. ${captionPart} Please read and analyze it.`.trim()
}

export function buildVideoMessage(localPath: string, caption?: string): string {
  const captionPart = caption ? ` Caption: ${caption}.` : ''
  return (
    `I've received a video at ${localPath}.${captionPart} ` +
    `Please analyze it using the Gemini API. ` +
    `The GOOGLE_API_KEY is available in the .env file at ${PROJECT_ROOT}/.env. ` +
    `Use the Google Generative AI SDK (or REST API) with the gemini-2.0-flash model. ` +
    `Upload the video file, then ask Gemini to describe and summarize the content.`
  )
}

export function cleanupOldUploads(maxAgeMs = 86400000): void {
  if (!existsSync(UPLOADS_DIR)) return

  const now = Date.now()
  let deleted = 0

  for (const entry of readdirSync(UPLOADS_DIR)) {
    const fullPath = path.join(UPLOADS_DIR, entry)
    try {
      const stat = statSync(fullPath)
      if (now - stat.mtimeMs > maxAgeMs) {
        unlinkSync(fullPath)
        deleted++
      }
    } catch (err) {
      logger.warn({ err, fullPath }, 'failed to stat or delete upload during cleanup')
    }
  }

  if (deleted > 0) {
    logger.info({ deleted }, 'cleaned up old uploads')
  }
}

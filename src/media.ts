import https from 'https'
import http from 'http'
import { createWriteStream, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { logger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')

export const UPLOADS_DIR = path.join(PROJECT_ROOT, 'workspace', 'uploads')
mkdirSync(UPLOADS_DIR, { recursive: true })

/**
 * Sanitize a filename: keep only safe characters.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-')
}

/**
 * Download a Telegram file by fileId.
 * Returns the local path where it was saved.
 */
export async function downloadMedia(
  botToken: string,
  fileId: string,
  originalFilename?: string
): Promise<string> {
  // Get file path from Telegram
  const fileMeta = await new Promise<{ result: { file_path: string } }>((resolve, reject) => {
    const url = `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
    https.get(url, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as { result: { file_path: string } })
        } catch (e) {
          reject(e)
        }
      })
    }).on('error', reject)
  })

  const tgFilePath = fileMeta.result.file_path
  const ext = path.extname(tgFilePath) || path.extname(originalFilename ?? '') || ''
  const baseName = originalFilename
    ? sanitizeFilename(path.basename(originalFilename, ext))
    : 'media'
  const localFilename = `${Date.now()}_${baseName}${ext}`
  const localPath = path.join(UPLOADS_DIR, localFilename)

  // Download the file
  await new Promise<void>((resolve, reject) => {
    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${tgFilePath}`
    https.get(downloadUrl, (res) => {
      const ws = createWriteStream(localPath)
      res.pipe(ws)
      ws.on('finish', resolve)
      ws.on('error', reject)
    }).on('error', reject)
  })

  logger.debug({ localPath }, 'Media downloaded')
  return localPath
}

/**
 * Build a prompt message for a photo.
 */
export function buildPhotoMessage(localPath: string, caption?: string): string {
  const parts = [
    `I've sent you a photo. The file is at: ${localPath}`,
    'Please analyze this image and describe what you see.',
  ]
  if (caption) parts.push(`Caption: ${caption}`)
  return parts.join('\n')
}

/**
 * Build a prompt message for a document.
 */
export function buildDocumentMessage(localPath: string, filename: string, caption?: string): string {
  const parts = [
    `I've sent you a document. File: ${filename}`,
    `Local path: ${localPath}`,
    'Please read and analyze this document.',
  ]
  if (caption) parts.push(`Caption: ${caption}`)
  return parts.join('\n')
}

/**
 * Build a prompt message for a video.
 * Instructs Claude to use Gemini API for video analysis.
 */
export function buildVideoMessage(localPath: string, caption?: string): string {
  const parts = [
    `I've sent you a video. The file is at: ${localPath}`,
    'Please analyze this video using the Gemini API (GOOGLE_API_KEY is in .env).',
    'Describe what you see and any relevant details.',
  ]
  if (caption) parts.push(`Caption: ${caption}`)
  return parts.join('\n')
}

/**
 * Delete uploads older than maxAgeMs (default 24h).
 */
export function cleanupOldUploads(maxAgeMs = 24 * 60 * 60 * 1000): void {
  try {
    const now = Date.now()
    const files = readdirSync(UPLOADS_DIR)
    let cleaned = 0
    for (const file of files) {
      const fp = path.join(UPLOADS_DIR, file)
      try {
        const stat = statSync(fp)
        if (now - stat.mtimeMs > maxAgeMs) {
          unlinkSync(fp)
          cleaned++
        }
      } catch {
        // ignore individual file errors
      }
    }
    if (cleaned > 0) logger.info({ cleaned }, 'Cleaned up old uploads')
  } catch (err) {
    logger.warn({ err }, 'cleanupOldUploads error')
  }
}

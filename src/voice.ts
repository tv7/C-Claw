import https from 'https'
import http from 'http'
import { readFileSync, renameSync } from 'fs'
import path from 'path'
import { readEnvFile } from './env.js'
import { logger } from './logger.js'

function getConfig() {
  return readEnvFile()
}

/**
 * Transcribe audio using Groq Whisper API.
 * Renames .oga → .ogg before sending (Groq requirement).
 */
export async function transcribeAudio(filePath: string): Promise<string> {
  const config = getConfig()
  const groqKey = config['GROQ_API_KEY'] ?? ''
  if (!groqKey) throw new Error('GROQ_API_KEY not configured')

  // Groq won't accept .oga — rename to .ogg (same format, different extension)
  let actualPath = filePath
  if (filePath.endsWith('.oga')) {
    actualPath = filePath.replace(/\.oga$/, '.ogg')
    renameSync(filePath, actualPath)
  }

  const fileBuffer = readFileSync(actualPath)
  const filename = path.basename(actualPath)
  const boundary = `----FormBoundary${Date.now().toString(16)}`

  const formParts: Buffer[] = []
  // model field
  formParts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3\r\n`
  ))
  // file field
  formParts.push(Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/ogg\r\n\r\n`
  ))
  formParts.push(fileBuffer)
  formParts.push(Buffer.from(`\r\n--${boundary}--\r\n`))
  const body = Buffer.concat(formParts)

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as Record<string, unknown>
          if (parsed.text) resolve(String(parsed.text))
          else reject(new Error(`Groq API error: ${data}`))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * Synthesize speech using ElevenLabs API.
 * Returns MP3 as Buffer.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const config = getConfig()
  const apiKey = config['ELEVENLABS_API_KEY'] ?? ''
  const voiceId = config['ELEVENLABS_VOICE_ID'] ?? ''
  if (!apiKey || !voiceId) throw new Error('ElevenLabs API key or voice ID not configured')

  const bodyData = JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2_5',
    voice_settings: { stability: 0.5, similarity_boost: 0.75 },
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyData),
        'Accept': 'audio/mpeg',
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`ElevenLabs error: ${res.statusCode} ${Buffer.concat(chunks).toString()}`))
        } else {
          resolve(Buffer.concat(chunks))
        }
      })
    })
    req.on('error', reject)
    req.write(bodyData)
    req.end()
  })
}

/**
 * Check which voice capabilities are configured.
 */
export function voiceCapabilities(): { stt: boolean; tts: boolean } {
  const config = getConfig()
  return {
    stt: Boolean(config['GROQ_API_KEY']),
    tts: Boolean(config['ELEVENLABS_API_KEY'] && config['ELEVENLABS_VOICE_ID']),
  }
}

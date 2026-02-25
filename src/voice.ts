import { createReadStream } from 'fs'
import { readFileSync, renameSync, existsSync } from 'fs'
import path from 'path'
import https from 'https'
import { GROQ_API_KEY, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from './config.js'

export function voiceCapabilities(): { stt: boolean; tts: boolean } {
  return {
    stt: GROQ_API_KEY !== '',
    tts: ELEVENLABS_API_KEY !== '' && ELEVENLABS_VOICE_ID !== '',
  }
}

function httpsRequest(
  options: https.RequestOptions,
  body?: Buffer | string
): Promise<{ statusCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks),
        })
      })
    })

    req.on('error', reject)

    if (body) {
      req.write(body)
    }
    req.end()
  })
}

export async function transcribeAudio(filePath: string): Promise<string> {
  let actualPath = filePath

  // If file ends in .oga, rename to .ogg (same format, Groq requires .ogg)
  if (filePath.endsWith('.oga')) {
    const newPath = filePath.replace(/\.oga$/, '.ogg')
    if (existsSync(filePath)) {
      renameSync(filePath, newPath)
    }
    actualPath = newPath
  }

  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`
  const filename = path.basename(actualPath)
  const fileBuffer = readFileSync(actualPath)

  // Build multipart/form-data manually
  const parts: Buffer[] = []

  // model field
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `whisper-large-v3\r\n`
    )
  )

  // response_format field
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
        `json\r\n`
    )
  )

  // file field
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: audio/ogg\r\n\r\n`
    )
  )
  parts.push(fileBuffer)
  parts.push(Buffer.from(`\r\n`))

  // closing boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`))

  const body = Buffer.concat(parts)

  const response = await httpsRequest(
    {
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    },
    body
  )

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `Groq transcription failed with status ${response.statusCode}: ${response.body.toString('utf8')}`
    )
  }

  const parsed = JSON.parse(response.body.toString('utf8')) as { text?: string }
  if (!parsed.text) {
    throw new Error('Groq transcription returned empty text')
  }

  return parsed.text
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const bodyJson = JSON.stringify({
    text,
    model_id: 'eleven_turbo_v2_5',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
    },
  })

  const response = await httpsRequest(
    {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyJson),
        Accept: 'audio/mpeg',
      },
    },
    bodyJson
  )

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(
      `ElevenLabs TTS failed with status ${response.statusCode}: ${response.body.toString('utf8')}`
    )
  }

  return response.body
}

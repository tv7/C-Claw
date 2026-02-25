import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(__dirname, '..')

export function readEnvFile(keys?: string[]): Record<string, string> {
  const envPath = path.join(PROJECT_ROOT, '.env')
  const result: Record<string, string> = {}

  try {
    const contents = readFileSync(envPath, 'utf8')
    for (const rawLine of contents.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue

      const eqIdx = line.indexOf('=')
      if (eqIdx === -1) continue

      const key = line.slice(0, eqIdx).trim()
      if (!key) continue

      let value = line.slice(eqIdx + 1).trim()

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }

      result[key] = value
    }
  } catch {
    return {}
  }

  if (keys && keys.length > 0) {
    const filtered: Record<string, string> = {}
    for (const k of keys) {
      if (result[k] !== undefined) {
        filtered[k] = result[k]
      }
    }
    return filtered
  }

  return result
}

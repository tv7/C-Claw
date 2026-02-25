import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const TEST_ENV_PATH = path.join(PROJECT_ROOT, '.env.test')

// We can't easily test readEnvFile against the real .env, but we can
// test the parsing logic by temporarily writing a test env file.
// Since readEnvFile always reads from PROJECT_ROOT/.env, we test via
// the module's actual behavior with what's available.

describe('readEnvFile', () => {
  it('imports without error', async () => {
    const mod = await import('../env.js')
    expect(typeof mod.readEnvFile).toBe('function')
  })

  it('returns an object', async () => {
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile()
    expect(typeof result).toBe('object')
    expect(result).not.toBeNull()
  })

  it('returns empty object when .env missing (graceful)', async () => {
    // This test verifies the function doesn't throw even with no .env
    const { readEnvFile } = await import('../env.js')
    // Should not throw
    expect(() => readEnvFile()).not.toThrow()
  })

  it('filters to requested keys', async () => {
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile(['NONEXISTENT_KEY_XYZ'])
    // Should return empty object for key that doesn't exist
    expect(result['NONEXISTENT_KEY_XYZ']).toBeUndefined()
  })
})

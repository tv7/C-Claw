import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../..')
const TEST_ENV = path.join(PROJECT_ROOT, '.env.test')

// Temporarily override env path by writing a test .env
describe('readEnvFile', () => {
  afterEach(() => {
    if (existsSync(TEST_ENV)) unlinkSync(TEST_ENV)
  })

  it('parses simple key=value pairs', async () => {
    // Write a temporary .env for testing
    writeFileSync(path.join(PROJECT_ROOT, '.env'), 'TEST_FOO=bar\nTEST_BAZ=qux\n')
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile(['TEST_FOO', 'TEST_BAZ'])
    expect(result['TEST_FOO']).toBe('bar')
    expect(result['TEST_BAZ']).toBe('qux')
  })

  it('handles double-quoted values', async () => {
    writeFileSync(path.join(PROJECT_ROOT, '.env'), 'QUOTED="hello world"\n')
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile(['QUOTED'])
    expect(result['QUOTED']).toBe('hello world')
  })

  it('handles single-quoted values', async () => {
    writeFileSync(path.join(PROJECT_ROOT, '.env'), "SINGLE='test value'\n")
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile(['SINGLE'])
    expect(result['SINGLE']).toBe('test value')
  })

  it('skips comment lines', async () => {
    writeFileSync(path.join(PROJECT_ROOT, '.env'), '# This is a comment\nREAL_KEY=value\n')
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile()
    expect(result['REAL_KEY']).toBe('value')
    expect(result['# This is a comment']).toBeUndefined()
  })

  it('returns empty object for missing .env', async () => {
    // Remove .env if exists for this test
    const envPath = path.join(PROJECT_ROOT, '.env')
    const backup = existsSync(envPath) ? (() => { const c = require('fs').readFileSync(envPath, 'utf-8'); return c })() : null
    if (existsSync(envPath)) unlinkSync(envPath)

    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile()
    expect(result).toEqual({})

    if (backup) writeFileSync(envPath, backup)
  })

  it('filters by requested keys', async () => {
    writeFileSync(path.join(PROJECT_ROOT, '.env'), 'KEY_A=1\nKEY_B=2\nKEY_C=3\n')
    const { readEnvFile } = await import('../env.js')
    const result = readEnvFile(['KEY_A', 'KEY_C'])
    expect(result['KEY_A']).toBe('1')
    expect(result['KEY_B']).toBeUndefined()
    expect(result['KEY_C']).toBe('3')
  })
})

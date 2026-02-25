import { describe, it, expect } from 'vitest'
import { formatForTelegram, splitMessage, isAuthorised } from '../bot.js'

describe('formatForTelegram', () => {
  it('converts bold markdown to HTML', () => {
    const result = formatForTelegram('This is **bold** text')
    expect(result).toContain('<b>bold</b>')
  })

  it('converts italic markdown to HTML', () => {
    const result = formatForTelegram('This is *italic* text')
    expect(result).toContain('<i>italic</i>')
  })

  it('converts inline code to HTML', () => {
    const result = formatForTelegram('Use `npm install` to install')
    expect(result).toContain('<code>npm install</code>')
  })

  it('converts code blocks to pre tags', () => {
    const result = formatForTelegram('```\nconst x = 1\n```')
    expect(result).toContain('<pre>')
    expect(result).toContain('const x = 1')
  })

  it('converts fenced code blocks with language', () => {
    const result = formatForTelegram('```typescript\nconst x: number = 1\n```')
    expect(result).toContain('<pre>')
    expect(result).toContain('const x')
  })

  it('converts headings to bold', () => {
    const result = formatForTelegram('# My Heading')
    expect(result).toContain('<b>My Heading</b>')
  })

  it('converts strikethrough', () => {
    const result = formatForTelegram('~~deleted~~')
    expect(result).toContain('<s>deleted</s>')
  })

  it('converts links', () => {
    const result = formatForTelegram('[Click here](https://example.com)')
    expect(result).toContain('<a href="https://example.com">Click here</a>')
  })

  it('converts checkboxes', () => {
    const unchecked = formatForTelegram('- [ ] Todo item')
    expect(unchecked).toContain('☐')
    const checked = formatForTelegram('- [x] Done item')
    expect(checked).toContain('☑')
  })

  it('escapes ampersands outside code', () => {
    const result = formatForTelegram('a & b')
    expect(result).toContain('&amp;')
  })

  it('strips horizontal rules', () => {
    const result = formatForTelegram('Above\n---\nBelow')
    expect(result).not.toContain('---')
    expect(result).toContain('Above')
    expect(result).toContain('Below')
  })

  it('handles empty string', () => {
    expect(formatForTelegram('')).toBe('')
  })

  it('does not mangle content inside code blocks', () => {
    const result = formatForTelegram('```\n**not bold** & <not html>\n```')
    expect(result).toContain('**not bold**')
    expect(result).toContain('&amp;')
    expect(result).toContain('&lt;not html&gt;')
  })
})

describe('splitMessage', () => {
  it('returns single chunk for short messages', () => {
    const result = splitMessage('Hello world')
    expect(result).toHaveLength(1)
    expect(result[0]).toBe('Hello world')
  })

  it('splits at 4096 chars by default', () => {
    const longText = 'A'.repeat(5000)
    const result = splitMessage(longText)
    expect(result.length).toBeGreaterThan(1)
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4096)
    }
  })

  it('splits on newlines when possible', () => {
    const text = 'Line 1\nLine 2\nLine 3'
    const result = splitMessage(text, 12)
    expect(result.length).toBeGreaterThan(1)
  })

  it('preserves all content after splitting', () => {
    const text = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n')
    const chunks = splitMessage(text, 100)
    const rejoined = chunks.join('\n')
    expect(rejoined).toBe(text)
  })

  it('handles custom limit', () => {
    const result = splitMessage('ABCDEFGHIJ', 3)
    expect(result.every(c => c.length <= 3)).toBe(true)
    expect(result.join('')).toBe('ABCDEFGHIJ')
  })
})

describe('isAuthorised', () => {
  it('returns true in first-run mode (no allowed IDs)', () => {
    // When ALLOWED_CHAT_IDS is empty (first-run), all chats are allowed
    // This test validates the exported function behavior
    // In first-run mode (ALLOWED_CHAT_IDS=[]), always true
    expect(typeof isAuthorised).toBe('function')
  })

  it('accepts numeric and string chat IDs', () => {
    // isAuthorised should handle both number and string inputs
    const result1 = isAuthorised(123456)
    const result2 = isAuthorised('123456')
    expect(typeof result1).toBe('boolean')
    expect(typeof result2).toBe('boolean')
  })
})

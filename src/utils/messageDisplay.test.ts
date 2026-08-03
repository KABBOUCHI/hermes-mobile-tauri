import { describe, expect, it } from 'vitest'
import {
  USER_MESSAGE_EXPANSION_CHAR_LIMIT,
  USER_MESSAGE_EXPANSION_LINE_LIMIT,
  shouldOfferMessageExpansion,
} from './messageDisplay'

describe('shouldOfferMessageExpansion', () => {
  it('does not expand short prompts', () => {
    expect(shouldOfferMessageExpansion('A short request')).toBe(false)
  })

  it('expands prompts beyond the mobile character threshold', () => {
    expect(shouldOfferMessageExpansion('x'.repeat(USER_MESSAGE_EXPANSION_CHAR_LIMIT + 1))).toBe(true)
  })

  it('expands prompts with many explicit lines', () => {
    const prompt = Array.from({ length: USER_MESSAGE_EXPANSION_LINE_LIMIT + 1 }, (_, index) => `line ${index}`).join('\n')
    expect(shouldOfferMessageExpansion(prompt)).toBe(true)
  })

  it('ignores surrounding whitespace when deciding', () => {
    expect(shouldOfferMessageExpansion(`  ${'x'.repeat(USER_MESSAGE_EXPANSION_CHAR_LIMIT + 1)}  `)).toBe(true)
    expect(shouldOfferMessageExpansion('   ')).toBe(false)
  })
})

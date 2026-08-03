import { beforeEach, describe, expect, it } from 'vitest'
import {
  browseBackward,
  browseForward,
  clearComposerBrowseState,
  deriveUserHistory,
  isBrowsingComposerHistory,
  resetComposerBrowse,
} from './composerInputHistory'

const SESSION_A = 'session-a'
const SESSION_B = 'session-b'
const HISTORY = ['third', 'second', 'first']

beforeEach(() => {
  clearComposerBrowseState()
})

describe('deriveUserHistory', () => {
  it('returns non-empty user prompts newest-first', () => {
    const messages = [
      { role: 'user', content: '   ' },
      { role: 'assistant', content: 'ignored' },
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ]

    expect(deriveUserHistory(messages, message => message.content)).toEqual(['second', 'first'])
  })
})

describe('browseBackward', () => {
  it('recalls the newest prompt and preserves the current draft', () => {
    expect(browseBackward(SESSION_A, 'unsent draft', HISTORY)).toBe('third')
    expect(browseForward(SESSION_A, HISTORY)).toEqual({ text: 'unsent draft', returnedToPresent: true })
  })

  it('walks to older prompts and stops at the oldest', () => {
    expect(browseBackward(SESSION_A, '', HISTORY)).toBe('third')
    expect(browseBackward(SESSION_A, '', HISTORY)).toBe('second')
    expect(browseBackward(SESSION_A, '', HISTORY)).toBe('first')
    expect(browseBackward(SESSION_A, '', HISTORY)).toBeNull()
  })

  it('does nothing for an empty history or missing session', () => {
    expect(browseBackward(SESSION_A, '', [])).toBeNull()
    expect(browseBackward('', '', HISTORY)).toBeNull()
  })
})

describe('browseForward', () => {
  it('moves toward the newest prompt before returning to the draft', () => {
    browseBackward(SESSION_A, 'draft', HISTORY)
    browseBackward(SESSION_A, '', HISTORY)

    expect(browseForward(SESSION_A, HISTORY)).toEqual({ text: 'third', returnedToPresent: false })
    expect(browseForward(SESSION_A, HISTORY)).toEqual({ text: 'draft', returnedToPresent: true })
    expect(isBrowsingComposerHistory(SESSION_A)).toBe(false)
  })

  it('does nothing when the composer is not browsing', () => {
    expect(browseForward(SESSION_A, HISTORY)).toBeNull()
  })
})

describe('session isolation', () => {
  it('keeps cursors and drafts independent between sessions', () => {
    browseBackward(SESSION_A, 'draft-a', HISTORY)
    browseBackward(SESSION_A, '', HISTORY)
    browseBackward(SESSION_B, 'draft-b', HISTORY)

    expect(browseForward(SESSION_A, HISTORY)).toEqual({ text: 'third', returnedToPresent: false })
    expect(browseForward(SESSION_B, HISTORY)).toEqual({ text: 'draft-b', returnedToPresent: true })
  })

  it('resets browsing without affecting the derived history', () => {
    browseBackward(SESSION_A, 'draft', HISTORY)
    resetComposerBrowse(SESSION_A)

    expect(isBrowsingComposerHistory(SESSION_A)).toBe(false)
    expect(browseBackward(SESSION_A, '', HISTORY)).toBe('third')
  })
})

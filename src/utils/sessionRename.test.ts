import { describe, expect, it } from 'vitest'
import { runtimeIdForStoredSession } from './sessionRename'

describe('runtime session lookup for rename', () => {
  it('prefers the active turn mapping for the stored session', () => {
    const mappings = new Map([
      ['runtime-old', 'stored-session'],
      ['runtime-other', 'other-session'],
    ])

    expect(runtimeIdForStoredSession(
      'stored-session',
      { sessionId: 'runtime-active', storedSessionId: 'stored-session' },
      mappings,
    )).toBe('runtime-active')
  })

  it('finds a mapped runtime session for an idle branch', () => {
    const mappings = new Map([['runtime-branch', 'stored-branch']])

    expect(runtimeIdForStoredSession('stored-branch', null, mappings)).toBe('runtime-branch')
  })

  it('returns null for blank or unknown stored ids', () => {
    const mappings = new Map([['runtime-branch', 'stored-branch']])

    expect(runtimeIdForStoredSession('  ', null, mappings)).toBeNull()
    expect(runtimeIdForStoredSession('missing', null, mappings)).toBeNull()
  })
})

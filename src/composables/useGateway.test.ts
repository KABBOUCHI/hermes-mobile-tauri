import { describe, expect, it } from 'vitest'
import { branchSessionParams, MESSAGE_FETCH_TIMEOUT, SESSION_PICKER_LIMIT, SESSION_REFRESH_DEBOUNCE_MS, sessionListPath, sessionPickerPath, shouldInterruptBeforeRewind, shouldRefreshSessionsForEvent } from './useGateway'


describe('session list request policy', () => {
  it('matches desktop’s unscoped list path so sessions from every source remain visible', () => {
    expect(sessionListPath(40, 80, 'exclude')).toBe(
      '/api/sessions?limit=40&offset=80&min_messages=1&archived=exclude&order=recent',
    )
  })

  it('uses the desktop-sized recent window for the quick session picker', () => {
    expect(SESSION_PICKER_LIMIT).toBe(200)
    expect(sessionPickerPath()).toBe(
      '/api/sessions?limit=200&offset=0&min_messages=1&archived=exclude&order=recent',
    )
  })

  it('keeps the archived scope in the list request', () => {
    expect(sessionListPath(40, 0, 'only')).toContain('archived=only')
  })
})

describe('message history fetch policy', () => {
  it('allows long mobile transcript downloads more time than lightweight gateway calls', () => {
    expect(MESSAGE_FETCH_TIMEOUT).toBeGreaterThanOrEqual(60_000)
  })
})

describe('branch request policy', () => {
  it('preserves the parent workspace while matching the desktop request shape', () => {
    expect(branchSessionParams(' parent ', [
      { role: 'user', content: 'Inspect the repo' },
      { role: 'tool', content: 'ignored activity' },
      { role: 'assistant', content: 'I found the workspace.' },
    ], '  /work/hermes  ')).toEqual({
      cols: 96,
      source: 'desktop',
      cwd: '/work/hermes',
      parent_session_id: 'parent',
      messages: [
        { role: 'user', content: 'Inspect the repo' },
        { role: 'assistant', content: 'I found the workspace.' },
      ],
    })
  })

  it('omits an unavailable workspace without sending an empty cwd', () => {
    expect(branchSessionParams('parent', [{ role: 'user', content: 'Continue' }], '   ')).not.toHaveProperty('cwd')
  })
})

describe('rewind interruption policy', () => {
  it('does not interrupt an idle session before a regenerate or restore submit', () => {
    expect(shouldInterruptBeforeRewind(null, 'runtime-1')).toBe(false)
  })

  it('interrupts only the active runtime before replacing its turn', () => {
    expect(shouldInterruptBeforeRewind('runtime-1', 'runtime-1')).toBe(true)
    expect(shouldInterruptBeforeRewind('runtime-1', 'runtime-2')).toBe(false)
  })
})

describe('post-turn session refresh policy', () => {
  it('uses the same short coalescing window as the desktop sidebar', () => {
    expect(SESSION_REFRESH_DEBOUNCE_MS).toBe(300)
  })

  it('refreshes for completed background sessions with a stored identity', () => {
    expect(shouldRefreshSessionsForEvent('message.complete', 'background-session')).toBe(true)
    expect(shouldRefreshSessionsForEvent('message.complete', '  ')).toBe(false)
    expect(shouldRefreshSessionsForEvent('message.delta', 'background-session')).toBe(false)
  })
})

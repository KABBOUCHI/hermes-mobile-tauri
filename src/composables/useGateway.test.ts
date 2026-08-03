import { describe, expect, it } from 'vitest'
import { MESSAGE_FETCH_TIMEOUT, SESSION_PICKER_LIMIT, SESSION_REFRESH_DEBOUNCE_MS, sessionListPath, sessionPickerPath, shouldRefreshSessionsForEvent } from './useGateway'


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

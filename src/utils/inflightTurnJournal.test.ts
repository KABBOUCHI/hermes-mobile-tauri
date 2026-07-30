import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearInFlightTurn, persistInFlightTurn, recoverInFlightTurn } from './inflightTurnJournal'
import type { SessionMessage } from './sessionMessages'

const sessionId = 'session-1'
const user: SessionMessage = { role: 'user', content: 'Inspect the gateway', timestamp: 1 }
const partial: SessionMessage = { role: 'assistant', content: 'I found the', timestamp: 2 }

function createStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() { return entries.size },
    clear: () => entries.clear(),
    getItem: key => entries.get(key) ?? null,
    key: index => [...entries.keys()][index] ?? null,
    removeItem: key => { entries.delete(key) },
    setItem: (key, value) => { entries.set(key, String(value)) },
  }
}

let localStorage: Storage

describe('in-flight turn journal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage = createStorage()
    vi.stubGlobal('window', { localStorage })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('recovers a streamed assistant tail when refreshed history has only the prompt', () => {
    persistInFlightTurn(sessionId, [user, partial])
    vi.advanceTimersByTime(400)

    expect(recoverInFlightTurn(sessionId, [user])).toEqual([user, partial])
  })

  it('does not duplicate a completed gateway response and clears its stale snapshot', () => {
    persistInFlightTurn(sessionId, [user, partial])
    vi.advanceTimersByTime(400)
    const completed: SessionMessage = { role: 'assistant', content: 'I found the connection issue.', timestamp: 3 }

    expect(recoverInFlightTurn(sessionId, [user, completed])).toEqual([user, completed])
    expect(recoverInFlightTurn(sessionId, [user])).toEqual([user])
  })

  it('clears pending persistence when the turn completes before the throttle fires', () => {
    persistInFlightTurn(sessionId, [user, partial])
    clearInFlightTurn(sessionId)
    vi.advanceTimersByTime(400)

    expect(recoverInFlightTurn(sessionId, [user])).toEqual([user])
  })
})

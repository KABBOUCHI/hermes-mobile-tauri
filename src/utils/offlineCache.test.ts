import { describe, expect, it } from 'vitest'
import { createOfflineCache, offlineCacheScopeKey, type OfflineCacheStorage } from './offlineCache'

function memoryStorage(): OfflineCacheStorage {
  const values = new Map<string, string>()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
  }
}

describe('offline cache', () => {
  it('uses normalized gateway and profile identities to isolate cached data', () => {
    expect(offlineCacheScopeKey('https://Hermes.example.test/', ' work ')).toBe('https://hermes.example.test|work')
    expect(offlineCacheScopeKey('https://hermes.example.test', '')).toBe('https://hermes.example.test|default')
  })

  it('remembers only the most recently confirmed profile for a gateway', () => {
    const cache = createOfflineCache(memoryStorage(), () => 1_000)

    expect(cache.readLastProfile('https://hermes.example.test')).toBe('default')
    cache.writeLastProfile('https://hermes.example.test/', ' work ')

    expect(cache.readLastProfile('https://hermes.example.test')).toBe('work')
  })

  it('restores independent session and transcript entries only within their scope', () => {
    const cache = createOfflineCache(memoryStorage(), () => 1_000)
    const work = offlineCacheScopeKey('https://hermes.example.test', 'work')
    const personal = offlineCacheScopeKey('https://hermes.example.test', 'personal')

    cache.writeSessions(work, [{ id: 'work-session' }])
    cache.writeTranscript(work, 'work-session', [{ role: 'assistant', content: 'cached work' }])

    expect(cache.readSessions(work)).toEqual([{ id: 'work-session' }])
    expect(cache.readTranscript(work, 'work-session')).toEqual([{ role: 'assistant', content: 'cached work' }])
    expect(cache.readSessions(personal)).toBeNull()
    expect(cache.readTranscript(personal, 'work-session')).toBeNull()
  })

  it('expires stale data rather than presenting it as an offline transcript', () => {
    let now = 1_000
    const cache = createOfflineCache(memoryStorage(), () => now, 100)
    const scope = offlineCacheScopeKey('https://hermes.example.test', 'default')

    cache.writeSessions(scope, [{ id: 'session' }])
    now = 1_101

    expect(cache.readSessions(scope)).toBeNull()
  })

  it('clears only the requested gateway/profile scope', () => {
    const cache = createOfflineCache(memoryStorage(), () => 1_000)
    const work = offlineCacheScopeKey('https://hermes.example.test', 'work')
    const personal = offlineCacheScopeKey('https://hermes.example.test', 'personal')

    cache.writeSessions(work, [{ id: 'work-session' }])
    cache.writeTranscript(work, 'work-session', [{ role: 'assistant', content: 'work' }])
    cache.writeSessions(personal, [{ id: 'personal-session' }])
    cache.clearScope(work)

    expect(cache.readSessions(work)).toBeNull()
    expect(cache.readTranscript(work, 'work-session')).toBeNull()
    expect(cache.readSessions(personal)).toEqual([{ id: 'personal-session' }])
  })
})

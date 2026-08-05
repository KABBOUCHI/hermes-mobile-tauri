export interface OfflineCacheStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface CacheEntry<T> {
  savedAt: number
  value: T
}

const STORAGE_PREFIX = 'hermes.mobile.offline-cache.v1'
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_TRANSCRIPTS_PER_SCOPE = 16

function normalizedGatewayUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    const url = new URL(trimmed)
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase()
  }
}

/** Stable identity for a cache belonging to one gateway profile. */
export function offlineCacheScopeKey(gatewayUrl: string, profile: string): string {
  const gateway = normalizedGatewayUrl(gatewayUrl)
  const profileName = profile.trim() || 'default'
  return `${gateway}|${profileName}`
}

function sessionsKey(scope: string): string {
  return `${STORAGE_PREFIX}:sessions:${scope}`
}

function lastProfileKey(gatewayUrl: string): string {
  return `${STORAGE_PREFIX}:last-profile:${normalizedGatewayUrl(gatewayUrl)}`
}

function transcriptIndexKey(scope: string): string {
  return `${STORAGE_PREFIX}:transcript-index:${scope}`
}

function transcriptKey(scope: string, sessionId: string): string {
  return `${STORAGE_PREFIX}:transcript:${scope}:${sessionId}`
}

function parseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function clone<T>(value: T): T | null {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return null
  }
}

function isFresh(entry: unknown, now: number, maxAgeMs: number): entry is CacheEntry<unknown> {
  if (!entry || typeof entry !== 'object') return false
  const savedAt = (entry as Record<string, unknown>).savedAt
  return typeof savedAt === 'number' && Number.isFinite(savedAt) && now - savedAt <= maxAgeMs
}

function readTranscriptIds(storage: OfflineCacheStorage, scope: string): string[] {
  const parsed = parseJson(storage.getItem(transcriptIndexKey(scope)))
  if (!Array.isArray(parsed)) return []
  return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
}

function writeTranscriptIds(storage: OfflineCacheStorage, scope: string, ids: readonly string[]): void {
  const normalized = [...new Set(ids.map(id => id.trim()).filter(Boolean))].slice(0, MAX_TRANSCRIPTS_PER_SCOPE)
  if (normalized.length === 0) storage.removeItem(transcriptIndexKey(scope))
  else storage.setItem(transcriptIndexKey(scope), JSON.stringify(normalized))
}

/**
 * Small, bounded persistence for read-only fallback data. It deliberately has
 * no knowledge of gateway payloads: callers keep the server authoritative and
 * write only successfully normalized rows.
 */
export function createOfflineCache(
  storage: OfflineCacheStorage | null,
  now: () => number = Date.now,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
) {
  function readEntry<T>(key: string): T | null {
    if (!storage) return null
    const entry = parseJson(storage.getItem(key))
    if (!isFresh(entry, now(), maxAgeMs)) {
      storage.removeItem(key)
      return null
    }

    const value = (entry as CacheEntry<T>).value
    return clone(value)
  }

  function writeEntry<T>(key: string, value: T): void {
    if (!storage) return
    const cloned = clone(value)
    if (cloned === null) return
    try {
      storage.setItem(key, JSON.stringify({ savedAt: now(), value: cloned }))
    } catch {
      // Storage quota and private-mode failures must not affect usable chats.
    }
  }

  return {
    readLastProfile(gatewayUrl: string): string {
      if (!storage) return 'default'
      const value = storage.getItem(lastProfileKey(gatewayUrl))?.trim()
      return value || 'default'
    },

    writeLastProfile(gatewayUrl: string, profile: string): void {
      if (!storage) return
      const normalized = profile.trim() || 'default'
      try {
        storage.setItem(lastProfileKey(gatewayUrl), normalized)
      } catch {
        // Profile persistence only improves cache isolation; it is never critical.
      }
    },

    readSessions<T>(scope: string): T[] | null {
      const sessions = readEntry<unknown>(sessionsKey(scope))
      return Array.isArray(sessions) ? sessions as T[] : null
    },

    writeSessions<T>(scope: string, sessions: readonly T[]): void {
      writeEntry(sessionsKey(scope), [...sessions])
    },

    readTranscript<T>(scope: string, sessionId: string): T[] | null {
      const id = sessionId.trim()
      if (!id) return null
      const messages = readEntry<unknown>(transcriptKey(scope, id))
      return Array.isArray(messages) ? messages as T[] : null
    },

    writeTranscript<T>(scope: string, sessionId: string, messages: readonly T[]): void {
      if (!storage) return
      const id = sessionId.trim()
      if (!id) return

      writeEntry(transcriptKey(scope, id), [...messages])
      const existing = readTranscriptIds(storage, scope).filter(existingId => existingId !== id)
      const retained = [id, ...existing].slice(0, MAX_TRANSCRIPTS_PER_SCOPE)
      for (const staleId of existing.slice(MAX_TRANSCRIPTS_PER_SCOPE - 1)) {
        if (!retained.includes(staleId)) storage.removeItem(transcriptKey(scope, staleId))
      }
      writeTranscriptIds(storage, scope, retained)
    },

    clearScope(scope: string): void {
      if (!storage) return
      storage.removeItem(sessionsKey(scope))
      for (const sessionId of readTranscriptIds(storage, scope)) {
        storage.removeItem(transcriptKey(scope, sessionId))
      }
      storage.removeItem(transcriptIndexKey(scope))
    },
  }
}

function browserStorage(): OfflineCacheStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export const offlineCache = createOfflineCache(browserStorage())

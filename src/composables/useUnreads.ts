import { load } from '@tauri-apps/plugin-store'

let storeInstance: Awaited<ReturnType<typeof load>> | null = null

async function initStore() {
  if (!storeInstance) {
    storeInstance = await load('unreads.json', { autoSave: true })
  }
  return storeInstance
}

/**
 * Tracks unread sessions by storing the last-seen message_count per session.
 * A session is "unread" if its current message_count > stored last-seen count.
 */
export function useUnreads() {
  const STORAGE_KEY = 'session_last_seen_counts'

  async function getLastSeenCounts(): Promise<Record<string, number>> {
    try {
      const s = await initStore()
      const val = await s.get<Record<string, number>>(STORAGE_KEY)
      return val || {}
    } catch {
      return {}
    }
  }

  async function markSessionRead(sessionId: string, messageCount: number): Promise<void> {
    try {
      const counts = await getLastSeenCounts()
      counts[sessionId] = messageCount
      const s = await initStore()
      await s.set(STORAGE_KEY, counts)
    } catch {}
  }

  async function markAllRead(sessions: { id: string; message_count: number }[]): Promise<void> {
    try {
      const counts: Record<string, number> = {}
      for (const s of sessions) {
        counts[s.id] = s.message_count
      }
      const store = await initStore()
      await store.set(STORAGE_KEY, counts)
    } catch {}
  }

  async function getUnreadIds(sessions: { id: string; message_count: number }[]): Promise<Set<string>> {
    const counts = await getLastSeenCounts()
    const unread = new Set<string>()
    for (const s of sessions) {
      const lastSeen = counts[s.id]
      if (lastSeen === undefined) {
        // First time seeing this session — not unread (fresh load)
        continue
      }
      if (s.message_count > lastSeen) {
        unread.add(s.id)
      }
    }
    return unread
  }

  return {
    getLastSeenCounts,
    markSessionRead,
    markAllRead,
    getUnreadIds,
  }
}

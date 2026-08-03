import { load } from '@tauri-apps/plugin-store'
import { sessionUnreadKey, unreadSessionIds, type UnreadSession } from '../utils/sessionUnread'

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

  async function markSessionRead(sessionId: string, messageCount: number, lineageRootId?: string | null): Promise<void> {
    try {
      const counts = await getLastSeenCounts()
      counts[sessionUnreadKey({ id: sessionId, _lineage_root_id: lineageRootId })] = messageCount
      const s = await initStore()
      await s.set(STORAGE_KEY, counts)
    } catch {}
  }

  async function markAllRead(sessions: UnreadSession[]): Promise<void> {
    try {
      const counts: Record<string, number> = {}
      for (const s of sessions) {
        counts[sessionUnreadKey(s)] = s.message_count
      }
      const store = await initStore()
      await store.set(STORAGE_KEY, counts)
    } catch {}
  }

  async function getUnreadIds(sessions: UnreadSession[]): Promise<Set<string>> {
    const counts = await getLastSeenCounts()
    return unreadSessionIds(sessions, counts)
  }

  return {
    getLastSeenCounts,
    markSessionRead,
    markAllRead,
    getUnreadIds,
  }
}

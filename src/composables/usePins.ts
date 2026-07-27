import { load } from '@tauri-apps/plugin-store'

let storeInstance: Awaited<ReturnType<typeof load>> | null = null

async function initStore() {
  if (!storeInstance) {
    storeInstance = await load('pins.json', { autoSave: true })
  }
  return storeInstance
}

export function usePins() {
  const STORAGE_KEY = 'pinned_session_ids'

  async function getPinnedIds(): Promise<string[]> {
    try {
      const s = await initStore()
      const val = await s.get<string[]>(STORAGE_KEY)
      return val || []
    } catch {
      return []
    }
  }

  async function isPinned(sessionId: string): Promise<boolean> {
    const ids = await getPinnedIds()
    return ids.includes(sessionId)
  }

  async function togglePin(sessionId: string): Promise<boolean> {
    const ids = await getPinnedIds()
    let newIds: string[]
    const isCurrentlyPinned = ids.includes(sessionId)

    if (isCurrentlyPinned) {
      newIds = ids.filter(id => id !== sessionId)
    } else {
      newIds = [sessionId, ...ids] // Add to front
    }

    try {
      const s = await initStore()
      await s.set(STORAGE_KEY, newIds)
    } catch {}

    return !isCurrentlyPinned
  }

  async function pinSession(sessionId: string): Promise<void> {
    const ids = await getPinnedIds()
    if (ids.includes(sessionId)) return
    const newIds = [sessionId, ...ids]
    try {
      const s = await initStore()
      await s.set(STORAGE_KEY, newIds)
    } catch {}
  }

  async function unpinSession(sessionId: string): Promise<void> {
    const ids = await getPinnedIds()
    const newIds = ids.filter(id => id !== sessionId)
    try {
      const s = await initStore()
      await s.set(STORAGE_KEY, newIds)
    } catch {}
  }

  async function setSessionPinnedRemote(
    sessionId: string,
    pinned: boolean,
    baseUrl: string,
    cookie: string,
  ): Promise<void> {
    try {
      const { fetch } = await import('@tauri-apps/plugin-http')
      const base = baseUrl.replace(/\/$/, '')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (cookie) headers['Cookie'] = cookie
      await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PATCH',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ pinned }),
      })
    } catch (err) {
      console.warn('[pins] Failed to sync pin to remote:', err)
    }
  }

  return {
    getPinnedIds,
    isPinned,
    togglePin,
    pinSession,
    unpinSession,
    setSessionPinnedRemote,
  }
}

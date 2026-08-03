import { load } from '@tauri-apps/plugin-store'
import { lastSessionStorageKey, storedSessionId } from '../utils/sessionMemory'

let storeInstance: Awaited<ReturnType<typeof load>> | null = null

async function initStore() {
  if (!storeInstance) {
    storeInstance = await load('settings.json', { autoSave: true })
  }
  return storeInstance
}

/**
 * Persist the last opened chat using the same settings store as auth and
 * preferences. The gateway URL scopes the key so switching gateways cannot
 * reopen a session belonging to another server.
 */
export function useLastSession() {
  async function getLastSessionId(gatewayUrl: string): Promise<string | null> {
    const key = lastSessionStorageKey(gatewayUrl)
    if (!key) return null

    try {
      const store = await initStore()
      return storedSessionId(await store.get<string>(key))
    } catch {
      return null
    }
  }

  async function setLastSessionId(gatewayUrl: string, sessionId: string): Promise<void> {
    const key = lastSessionStorageKey(gatewayUrl)
    const id = storedSessionId(sessionId)
    if (!key || !id) return

    try {
      const store = await initStore()
      await store.set(key, id)
    } catch {
      // Remembering a route is a convenience; it must never block navigation.
    }
  }

  async function clearLastSessionId(gatewayUrl: string, sessionId: string): Promise<void> {
    const key = lastSessionStorageKey(gatewayUrl)
    const id = storedSessionId(sessionId)
    if (!key || !id) return

    try {
      const store = await initStore()
      const remembered = storedSessionId(await store.get<string>(key))
      if (remembered === id) {
        await store.set(key, '')
      }
    } catch {
      // A deleted session should not make the delete action fail.
    }
  }

  return { getLastSessionId, setLastSessionId, clearLastSessionId }
}

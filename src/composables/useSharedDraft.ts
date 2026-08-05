import { ref } from 'vue'
import { addPluginListener, invoke, isTauri } from '@tauri-apps/api/core'
import { normalizeSharedDraft, type SharedDraft } from '../utils/sharedDraft'

const pendingSharedDraft = ref<SharedDraft | null>(null)
let started = false
let lastPayload = ''

function draftFromPayload(payload: unknown): SharedDraft | null {
  if (typeof payload === 'string') {
    try {
      return normalizeSharedDraft(JSON.parse(payload) as unknown)
    } catch {
      return null
    }
  }
  return normalizeSharedDraft(payload)
}

function acceptPayload(payload: unknown, onDraft: (draft: SharedDraft) => void): void {
  const draft = draftFromPayload(payload)
  if (!draft) return
  const fingerprint = JSON.stringify(draft)
  if (fingerprint === lastPayload) return
  lastPayload = fingerprint
  pendingSharedDraft.value = draft
  onDraft(draft)
}

/** Shared Android intent state, retained until the new-chat composer consumes it. */
export function useSharedDraft() {
  async function start(onDraft: (draft: SharedDraft) => void): Promise<void> {
    if (started || !isTauri()) return
    started = true

    try {
      await addPluginListener<unknown>('share-intent', 'share', event => {
        const payload = event && typeof event === 'object' && 'payload' in event
          ? (event as { payload: unknown }).payload
          : event
        acceptPayload(payload, onDraft)
      })
      const pending = await invoke<{ payload?: string | null }>('plugin:share-intent|pending_share')
      if (pending.payload) acceptPayload(pending.payload, onDraft)
    } catch (error) {
      // The desktop build intentionally has no Android share bridge.
      console.debug('[share-intent] native listener unavailable', error)
    }
  }

  async function consume(): Promise<SharedDraft | null> {
    const draft = pendingSharedDraft.value
    if (!draft) return null
    pendingSharedDraft.value = null
    lastPayload = ''
    try {
      await invoke('plugin:share-intent|clear_pending_share')
    } catch {
      // A delivered draft remains usable even if its native acknowledgement fails.
    }
    return draft
  }

  return { pendingSharedDraft, start, consume }
}

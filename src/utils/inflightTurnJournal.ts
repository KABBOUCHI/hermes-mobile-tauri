import type { SessionMessage } from './sessionMessages'

/**
 * Best-effort recovery for a mobile app close during a streaming response.
 *
 * The gateway remains authoritative, but it may not have committed the current
 * turn when Android destroys the WebView. Keep only the visible in-flight tail
 * locally, then reconcile it with refreshed history when the session opens.
 */
const STORAGE_KEY = 'hermes.mobile.inflight-turn-journal.v1'
const STORE_VERSION = 1
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const PERSIST_THROTTLE_MS = 400

export interface InFlightTurnSnapshot {
  messages: SessionMessage[]
  updatedAt: number
}

interface JournalStore {
  entries: Record<string, InFlightTurnSnapshot>
  version: number
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function emptyStore(): JournalStore {
  return { entries: {}, version: STORE_VERSION }
}

function isExpired(snapshot: InFlightTurnSnapshot): boolean {
  return Date.now() - snapshot.updatedAt > MAX_AGE_MS
}

function loadStore(): JournalStore {
  const store = storage()
  if (!store) return emptyStore()

  try {
    const raw = store.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw)
    if (parsed?.version !== STORE_VERSION || !parsed.entries || Array.isArray(parsed.entries)) return emptyStore()
    return { entries: parsed.entries, version: STORE_VERSION }
  } catch {
    return emptyStore()
  }
}

function saveStore(journal: JournalStore): void {
  const store = storage()
  if (!store) return

  try {
    const entries = Object.fromEntries(Object.entries(journal.entries).filter(([, snapshot]) => !isExpired(snapshot)))
    if (Object.keys(entries).length === 0) store.removeItem(STORAGE_KEY)
    else store.setItem(STORAGE_KEY, JSON.stringify({ entries, version: STORE_VERSION }))
  } catch {
    // Private-mode/quota errors must never interrupt a chat turn.
  }
}

function cloneMessages(messages: SessionMessage[]): SessionMessage[] {
  try {
    return JSON.parse(JSON.stringify(messages)) as SessionMessage[]
  } catch {
    return []
  }
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function sameUserMessage(left: SessionMessage, right: SessionMessage): boolean {
  return left.role === 'user' && right.role === 'user' && normalizedText(left.content) === normalizedText(right.content)
}

function recoverableTail(messages: SessionMessage[]): SessionMessage[] {
  let assistantIndex = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'assistant') {
      assistantIndex = index
      break
    }
  }
  if (assistantIndex < 0) return []

  for (let index = assistantIndex - 1; index >= 0; index--) {
    if (messages[index].role === 'user') return cloneMessages(messages.slice(index))
  }
  return []
}

const pendingSnapshots = new Map<string, SessionMessage[]>()
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>()

function writeSnapshot(sessionId: string, messages: SessionMessage[]): void {
  const tail = recoverableTail(messages)
  if (!tail.length) return
  const journal = loadStore()
  journal.entries[sessionId] = { messages: tail, updatedAt: Date.now() }
  saveStore(journal)
}

/** Persist the current visible tail, coalescing high-frequency stream deltas. */
export function persistInFlightTurn(sessionId: string, messages: SessionMessage[]): void {
  if (!sessionId) return
  pendingSnapshots.set(sessionId, cloneMessages(messages))
  if (persistTimers.has(sessionId)) return

  persistTimers.set(sessionId, setTimeout(() => {
    persistTimers.delete(sessionId)
    const latest = pendingSnapshots.get(sessionId)
    pendingSnapshots.delete(sessionId)
    if (latest) writeSnapshot(sessionId, latest)
  }, PERSIST_THROTTLE_MS))
}

export function clearInFlightTurn(sessionId: string): void {
  if (!sessionId) return
  const timer = persistTimers.get(sessionId)
  if (timer) clearTimeout(timer)
  persistTimers.delete(sessionId)
  pendingSnapshots.delete(sessionId)

  const journal = loadStore()
  if (!(sessionId in journal.entries)) return
  delete journal.entries[sessionId]
  saveStore(journal)
}

/**
 * Merge journaled progress after a history refresh. If the gateway already has
 * a completed reply, discard the stale local snapshot; otherwise retain it.
 */
export function recoverInFlightTurn(sessionId: string, baseMessages: SessionMessage[]): SessionMessage[] {
  if (!sessionId) return baseMessages
  const journal = loadStore()
  const snapshot = journal.entries[sessionId]
  if (!snapshot) return baseMessages
  if (isExpired(snapshot)) {
    delete journal.entries[sessionId]
    saveStore(journal)
    return baseMessages
  }

  const tail = snapshot.messages
  const journalUser = tail.find(message => message.role === 'user')
  const journalAssistant = [...tail].reverse().find(message => message.role === 'assistant')
  if (!journalUser || !journalAssistant) return baseMessages

  const userIndex = (() => {
    for (let index = baseMessages.length - 1; index >= 0; index--) {
      if (sameUserMessage(baseMessages[index], journalUser)) return index
    }
    return -1
  })()
  if (userIndex < 0) return [...baseMessages, ...cloneMessages(tail)]

  const afterUser = baseMessages.slice(userIndex + 1)
  const gatewayAssistant = afterUser.find(message => message.role === 'assistant')
  if (gatewayAssistant?.content.trim()) {
    // The server has committed the response; its durable version wins.
    clearInFlightTurn(sessionId)
    return baseMessages
  }

  return [...baseMessages.slice(0, userIndex + 1), ...cloneMessages(tail.slice(1))]
}

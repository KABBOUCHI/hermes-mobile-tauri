import type { PendingAttachment } from './composerAttachments'

export interface QueuedMessage {
  id: string
  text: string
  attachments: PendingAttachment[]
  queuedAt: number
}

export interface QueueAppendOptions {
  id?: string
  queuedAt?: number
}

export interface DequeuedMessage {
  entry: QueuedMessage | null
  queue: QueuedMessage[]
}

function cloneAttachments(attachments: readonly PendingAttachment[]): PendingAttachment[] {
  return attachments.map(attachment => ({ ...attachment }))
}

function cloneEntry(entry: QueuedMessage): QueuedMessage {
  return { ...entry, attachments: cloneAttachments(entry.attachments) }
}

function nextQueueId(): string {
  return `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/** Add one prompt without mutating the caller's queue or attachment objects. */
export function appendQueuedMessage(
  queue: readonly QueuedMessage[],
  text: string,
  attachments: readonly PendingAttachment[],
  options: QueueAppendOptions = {},
): { entry: QueuedMessage; queue: QueuedMessage[] } {
  const entry: QueuedMessage = {
    id: options.id || nextQueueId(),
    text,
    attachments: cloneAttachments(attachments),
    queuedAt: options.queuedAt ?? Date.now(),
  }

  return {
    entry,
    queue: [...queue.map(cloneEntry), entry],
  }
}

/** Remove one prompt by id. Missing ids are a safe no-op. */
export function removeQueuedMessage(queue: readonly QueuedMessage[], id: string): QueuedMessage[] {
  return queue.filter(entry => entry.id !== id).map(cloneEntry)
}

/** Take the FIFO head, leaving the original queue untouched. */
export function dequeueQueuedMessage(queue: readonly QueuedMessage[]): DequeuedMessage {
  const [entry, ...rest] = queue
  return {
    entry: entry ? cloneEntry(entry) : null,
    queue: rest.map(cloneEntry),
  }
}

// Queue state is presentation state, but it must survive route changes while
// the gateway keeps the live turn in the singleton composable. The gateway
// remains authoritative for sent messages; only pending local prompts live here.
const queuesBySession = new Map<string, QueuedMessage[]>()
const pausedSessions = new Set<string>()

export function getQueuedMessages(sessionId: string): QueuedMessage[] {
  return (queuesBySession.get(sessionId) || []).map(cloneEntry)
}

export function setQueuedMessages(sessionId: string, queue: readonly QueuedMessage[]): void {
  if (!sessionId.trim() || queue.length === 0) {
    queuesBySession.delete(sessionId)
    pausedSessions.delete(sessionId)
    return
  }
  queuesBySession.set(sessionId, queue.map(cloneEntry))
}

export function clearQueuedMessages(sessionId: string): void {
  queuesBySession.delete(sessionId)
  pausedSessions.delete(sessionId)
}

export function pauseQueuedMessages(sessionId: string): void {
  if (getQueuedMessages(sessionId).length > 0) pausedSessions.add(sessionId)
}

export function resumeQueuedMessages(sessionId: string): void {
  pausedSessions.delete(sessionId)
}

export function isQueuePaused(sessionId: string): boolean {
  return pausedSessions.has(sessionId)
}

/** Move pending prompts when a new-chat client id becomes a stored gateway id. */
export function migrateQueuedMessages(fromSessionId: string, toSessionId: string): boolean {
  if (!fromSessionId.trim() || !toSessionId.trim() || fromSessionId === toSessionId) return false

  const pending = getQueuedMessages(fromSessionId)
  if (pending.length === 0) return false

  const existing = getQueuedMessages(toSessionId)
  setQueuedMessages(toSessionId, [...existing, ...pending])
  const wasPaused = isQueuePaused(fromSessionId)
  clearQueuedMessages(fromSessionId)
  if (wasPaused) pauseQueuedMessages(toSessionId)
  return true
}

/** Test-only reset for the module singleton. */
export function resetQueuedMessageStore(): void {
  queuesBySession.clear()
  pausedSessions.clear()
}

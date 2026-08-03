export type SessionActivityState = 'needs-input' | 'working' | 'stalled' | 'background' | 'unread' | 'idle'

export interface SessionActivityInput {
  isActive: boolean
  isCurrentTurn: boolean
  isStalled?: boolean
  isUnread: boolean
  needsInput?: boolean
}

/**
 * Resolve the one status indicator shown on a session row.
 *
 * This mirrors desktop's sidebar priority: a blocking clarification first,
 * then the local turn, gateway-reported background work, and a completed unread turn.
 */
export function sessionActivityState({
  isActive,
  isCurrentTurn,
  isStalled = false,
  isUnread,
  needsInput = false,
}: SessionActivityInput): SessionActivityState {
  if (needsInput) return 'needs-input'
  if (isCurrentTurn) return isStalled ? 'stalled' : 'working'
  if (isActive) return 'background'
  if (isUnread) return 'unread'
  return 'idle'
}

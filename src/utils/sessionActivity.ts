export type SessionActivityState = 'needs-input' | 'working' | 'background' | 'unread' | 'idle'

export interface SessionActivityInput {
  isActive: boolean
  isCurrentTurn: boolean
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
  isUnread,
  needsInput = false,
}: SessionActivityInput): SessionActivityState {
  if (needsInput) return 'needs-input'
  if (isCurrentTurn) return 'working'
  if (isActive) return 'background'
  if (isUnread) return 'unread'
  return 'idle'
}

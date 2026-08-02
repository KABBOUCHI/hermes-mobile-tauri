export type SessionActivityState = 'working' | 'background' | 'unread' | 'idle'

export interface SessionActivityInput {
  isActive: boolean
  isCurrentTurn: boolean
  isUnread: boolean
}

/**
 * Resolve the one status indicator shown on a session row.
 *
 * This mirrors desktop's sidebar priority: the local turn is most urgent,
 * then gateway-reported background work, then a completed unread turn.
 */
export function sessionActivityState({
  isActive,
  isCurrentTurn,
  isUnread,
}: SessionActivityInput): SessionActivityState {
  if (isCurrentTurn) return 'working'
  if (isActive) return 'background'
  if (isUnread) return 'unread'
  return 'idle'
}

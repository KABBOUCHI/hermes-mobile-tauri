export interface UnreadSessionIdentity {
  id: string
  _lineage_root_id?: string | null
}

export interface UnreadSession extends UnreadSessionIdentity {
  message_count: number
}

/**
 * Desktop treats the lineage root as the durable session identity. The live tip
 * can change after compression, so unread markers must use the same stable key.
 */
export function sessionUnreadKey(session: UnreadSessionIdentity): string {
  return session._lineage_root_id?.trim() || session.id
}

/**
 * Read old markers written against a live id while the durable root marker is
 * being established. This keeps existing users' unread state intact during the
 * identity migration.
 */
function lastSeenCount(session: UnreadSessionIdentity, counts: Record<string, number>): number | undefined {
  const durableKey = sessionUnreadKey(session)
  if (counts[durableKey] !== undefined) return counts[durableKey]
  if (durableKey !== session.id) return counts[session.id]
  return undefined
}

export function unreadSessionIds(
  sessions: readonly UnreadSession[],
  counts: Record<string, number>,
): Set<string> {
  const unread = new Set<string>()
  for (const session of sessions) {
    const seen = lastSeenCount(session, counts)
    if (seen !== undefined && session.message_count > seen) {
      // Return the visible/live id so the row can render immediately.
      unread.add(session.id)
    }
  }
  return unread
}

export interface SessionKeepInput {
  pinnedIds: readonly string[]
  activeSessionId?: string | null
  activeSessionRows: readonly { id: string; is_active?: boolean }[]
  recentlySettledIds: readonly string[]
}

/**
 * Build the rows that must survive a desktop-style recent-page refresh.
 *
 * The sessions endpoint is a recency window, not the complete sidebar. A row
 * can be omitted while its turn is still running or immediately after it
 * finishes, so replacing the local list blindly makes active conversations
 * vanish. Keep the user's pins, the foreground turn, server-reported active
 * rows, and the short post-completion grace set together at the gateway seam.
 */
export function buildSessionListKeepIds({
  pinnedIds,
  activeSessionId,
  activeSessionRows,
  recentlySettledIds,
}: SessionKeepInput): Set<string> {
  const keep = new Set<string>()

  for (const id of pinnedIds) {
    const normalized = id.trim()
    if (normalized) keep.add(normalized)
  }

  const activeId = activeSessionId?.trim()
  if (activeId) {
    keep.add(activeId)
  }

  for (const session of activeSessionRows) {
    const id = session.id.trim()
    if (session.is_active && id) {
      keep.add(id)
    }
  }

  for (const id of recentlySettledIds) {
    const normalized = id.trim()
    if (normalized) keep.add(normalized)
  }

  return keep
}

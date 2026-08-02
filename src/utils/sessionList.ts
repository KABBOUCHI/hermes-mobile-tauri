/**
 * Reconcile an appended sessions page with the rows already visible.
 *
 * Gateway pages may overlap while activity is being persisted. Keep the first
 * page's visual order, replace overlapping rows with the newest server copy,
 * and append only genuinely new sessions.
 */
export function mergeSessionsById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const merged: T[] = []
  const indices = new Map<string, number>()

  for (const session of [...existing, ...incoming]) {
    const existingIndex = indices.get(session.id)
    if (existingIndex === undefined) {
      indices.set(session.id, merged.length)
      merged.push(session)
    } else {
      // Keep the first occurrence's position but replace it with the newest
      // server record, whether the overlap came from a prior page or this one.
      merged[existingIndex] = session
    }
  }

  return merged
}

/**
 * Reconcile a refreshed recent-session page without evicting rows the user
 * deliberately kept visible. Desktop preserves pinned/working rows because
 * the gateway page is only a recency window; the same rule prevents a pinned
 * mobile conversation from disappearing after an unrelated turn completes.
 *
 * A compressed session may rotate its live id while retaining its lineage root,
 * so deduplicate both identities when deciding whether an old row survived.
 */
export function mergeSessionPage<
  T extends { id: string; _lineage_root_id?: string | null; title?: string | null },
>(previous: T[], incoming: T[], keepIds: Iterable<string>): T[] {
  const previousById = new Map(previous.map(session => [session.id, session]))
  const merged = incoming.map(session => {
    if (session.title?.trim()) return session
    const carriedTitle = previousById.get(session.id)?.title?.trim()
    return carriedTitle ? { ...session, title: carriedTitle } : session
  })

  const keep = new Set(keepIds)
  if (keep.size === 0) return merged

  const incomingIds = new Set(merged.map(session => session.id))
  const incomingLineageIds = new Set(merged.map(session => session._lineage_root_id || session.id))
  const survivors = previous.filter(session => {
    const lineageId = session._lineage_root_id || session.id
    return !incomingIds.has(session.id)
      && !incomingLineageIds.has(lineageId)
      && (keep.has(session.id) || keep.has(lineageId))
  })

  return survivors.length ? [...survivors, ...merged] : merged
}

/**
 * Build the temporary row desktop shows immediately after creating a chat.
 * The session endpoint remains authoritative; a completed-turn refresh replaces
 * this preview with the server-generated title, preview, and message count.
 */
export function optimisticSessionForSend(
  id: string,
  preview: string,
  timestamp = Date.now() / 1000,
): {
  id: string
  title: null
  preview: string
  model: string
  message_count: number
  last_active: number
  started_at: number
  is_active: boolean
  source: string
} {
  return {
    id,
    title: null,
    preview: preview.trim(),
    model: '',
    message_count: 1,
    last_active: timestamp,
    started_at: timestamp,
    is_active: true,
    source: 'desktop',
  }
}

export interface SessionBranchEntry<T> {
  branchStem?: string
  session: T
}

export interface SessionPinIdentity {
  id: string
  _lineage_root_id?: string | null
}

/**
 * Desktop pins the durable lineage root so compression can rotate a live
 * session id without making the conversation fall out of the pinned section.
 */
export function sessionPinId(session: SessionPinIdentity): string {
  return session._lineage_root_id?.trim() || session.id
}

/** Keep pins written against an older live id visible during migration. */
export function sessionIsPinned(session: SessionPinIdentity, pinnedIds: readonly string[]): boolean {
  return pinnedIds.includes(sessionPinId(session)) || pinnedIds.includes(session.id)
}

/**
 * Resolve pinned rows in the persisted pin order rather than whatever recency
 * order the latest sessions page happened to use. This mirrors desktop's
 * sidebar, where the pin-id array is the user's deliberate ordering.
 * Unknown ids are ignored and duplicate ids cannot duplicate a visible row.
 */
export function orderSessionsByIds<T extends SessionPinIdentity>(sessions: readonly T[], ids: readonly string[]): T[] {
  const byId = new Map(sessions.map(session => [session.id, session]))
  const byPinId = new Map<string, T>()
  for (const session of sessions) {
    const pinId = sessionPinId(session)
    if (!byPinId.has(pinId)) byPinId.set(pinId, session)
  }

  const seen = new Set<string>()
  const ordered: T[] = []

  for (const id of ids) {
    const session = byId.get(id) || byPinId.get(id)
    if (session && !seen.has(session.id)) {
      seen.add(session.id)
      ordered.push(session)
    }
  }

  return ordered
}

/**
 * Keep forked conversations adjacent to their parent, mirroring the desktop
 * sidebar. A branch group's recency is its newest member, so a fresh fork does
 * not leave its parent stranded elsewhere in the list.
 */
export function flattenSessionsWithBranches<
  T extends { id: string; last_active?: number; started_at?: number; parent_session_id?: string | null; _lineage_root_id?: string | null },
>(sessions: readonly T[]): SessionBranchEntry<T>[] {
  if (sessions.length < 2) return sessions.map(session => ({ session }))

  const recency = (session: T) => session.last_active || session.started_at || 0
  const byVisibleId = new Map<string, T>()
  for (const session of sessions) {
    byVisibleId.set(session.id, session)
    const rootId = session._lineage_root_id?.trim()
    if (rootId) byVisibleId.set(rootId, session)
  }

  const childrenByParent = new Map<string, T[]>()
  const nestedIds = new Set<string>()
  for (const session of sessions) {
    const parentId = session.parent_session_id?.trim()
    const parent = parentId ? byVisibleId.get(parentId) : undefined
    if (!parent || parent.id === session.id) continue
    nestedIds.add(session.id)
    const children = childrenByParent.get(parent.id) || []
    children.push(session)
    childrenByParent.set(parent.id, children)
  }

  for (const children of childrenByParent.values()) {
    children.sort((left, right) => recency(right) - recency(left))
  }

  const groupRecencyMemo = new Map<string, number>()
  const groupRecency = (session: T): number => {
    const cached = groupRecencyMemo.get(session.id)
    if (cached !== undefined) return cached
    groupRecencyMemo.set(session.id, recency(session)) // cycle guard
    const newest = (childrenByParent.get(session.id) || []).reduce(
      (latest, child) => Math.max(latest, groupRecency(child)),
      recency(session),
    )
    groupRecencyMemo.set(session.id, newest)
    return newest
  }

  const entries: SessionBranchEntry<T>[] = []
  const seen = new Set<string>()
  const emit = (session: T, branchStem?: string) => {
    if (seen.has(session.id)) return
    seen.add(session.id)
    entries.push(branchStem ? { branchStem, session } : { session })
    const children = childrenByParent.get(session.id) || []
    children.forEach((child, index) => emit(child, index === children.length - 1 ? '└─' : '├─'))
  }

  sessions
    .filter(session => !nestedIds.has(session.id))
    .map((session, index) => ({ index, session }))
    .sort((left, right) => groupRecency(right.session) - groupRecency(left.session) || left.index - right.index)
    .forEach(({ session }) => emit(session))

  // A malformed parent cycle must not make a conversation disappear.
  for (const session of sessions) emit(session)
  return entries
}

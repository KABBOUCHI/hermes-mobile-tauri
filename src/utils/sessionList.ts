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

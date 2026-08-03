export interface ActiveRuntimeSession {
  sessionId: string
  storedSessionId: string
}

/**
 * Resolve the runtime identity required by Desktop's `session.title` RPC.
 * Prefer the foreground turn, then fall back to a remembered runtime mapping
 * for idle runtime-only sessions such as freshly created branches.
 */
export function runtimeIdForStoredSession(
  storedSessionId: string,
  activeTurn: ActiveRuntimeSession | null,
  runtimeToStoredSession: ReadonlyMap<string, string>,
): string | null {
  const storedId = storedSessionId.trim()
  if (!storedId) return null

  if (activeTurn?.storedSessionId === storedId && activeTurn.sessionId.trim()) {
    return activeTurn.sessionId
  }

  for (const [runtimeId, mappedStoredId] of runtimeToStoredSession) {
    if (mappedStoredId === storedId && runtimeId.trim()) return runtimeId
  }

  return null
}

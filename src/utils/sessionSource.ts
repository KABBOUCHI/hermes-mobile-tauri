export interface SourcedSession {
  source?: string | null
}

// A handed-off conversation keeps its original messaging platform in metadata
// while the live session source becomes local (desktop/CLI/TUI). Keep the
// platform badge aligned with Desktop without treating local sources as origins.
const LOCAL_SOURCE_IDS = new Set(['cli', 'codex', 'desktop', 'gateway', 'local', 'tui'])

export function handoffOriginSource(
  handoffState: string | null | undefined,
  handoffPlatform: string | null | undefined,
): string | null {
  if (handoffState?.trim().toLowerCase() !== 'completed') return null

  const origin = handoffPlatform?.trim().toLowerCase() || ''
  return origin && !LOCAL_SOURCE_IDS.has(origin) ? origin : null
}

export function filterSessionsBySource<T extends SourcedSession>(sessions: T[], source: string): T[] {
  if (source === 'all') return sessions
  return sessions.filter(session => session.source === source)
}

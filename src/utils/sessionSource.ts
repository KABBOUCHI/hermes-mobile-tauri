export interface SourcedSession {
  source?: string | null
}

export function filterSessionsBySource<T extends SourcedSession>(sessions: T[], source: string): T[] {
  if (source === 'all') return sessions
  return sessions.filter(session => session.source === source)
}

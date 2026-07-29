export interface SessionExportInput<TSession = unknown, TMessage = unknown> {
  sessionId: string
  title: string | null | undefined
  session: TSession | null
  messages: TMessage[]
  exportedAt?: string
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Mirrors desktop's portable JSON session export contract. */
export function createSessionExport<TSession = unknown, TMessage = unknown>(input: SessionExportInput<TSession, TMessage>) {
  const providedTitle = input.title?.trim() || ''
  const title = providedTitle || 'Hermes Chat'
  const sessionId = input.sessionId || null
  const titlePart = sanitizeFilenamePart(providedTitle) || 'session'
  const idPart = sanitizeFilenamePart(input.sessionId).slice(0, 8).replace(/-+$/g, '') || 'chat'
  const payload = {
    exported_at: input.exportedAt || new Date().toISOString(),
    session_id: sessionId,
    title,
    session: input.session,
    message_count: input.messages.length,
    messages: input.messages,
  }

  return {
    fileName: `${titlePart}-${idPart}.json`,
    serialized: JSON.stringify(payload, null, 2),
  }
}

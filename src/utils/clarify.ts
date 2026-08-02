export interface ClarifyRequest {
  requestId: string
  question: string
  choices: string[] | null
  sessionId: string
}

/**
 * Normalize the blocking clarification event emitted by the gateway.
 *
 * The desktop client treats this event as authoritative input state rather
 * than transcript text: the agent is paused until the matching response RPC
 * arrives. Invalid choices fall back to the free-text field instead of leaving
 * the chat with buttons that cannot be selected reliably.
 */
export function normalizeClarifyRequest(payload: unknown, sessionId: string | null): ClarifyRequest | null {
  if (!payload || typeof payload !== 'object' || !sessionId) return null

  const record = payload as Record<string, unknown>
  const requestId = typeof record.request_id === 'string' ? record.request_id.trim() : ''
  const question = typeof record.question === 'string' ? record.question.trim() : ''
  if (!requestId || !question) return null

  const choices = Array.isArray(record.choices)
    ? record.choices.filter(
        (choice): choice is string =>
          typeof choice === 'string' && choice.trim().length > 0 && choice.length <= 200 && !choice.includes('\n'),
      )
    : []

  return {
    requestId,
    question,
    choices: choices.length > 0 ? choices : null,
    sessionId,
  }
}

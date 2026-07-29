export type MessageRole = 'user' | 'assistant' | 'tool'

export interface ToolCallSummary {
  id: string
  name: string
}

export interface ToolResultSummary {
  id: string
  name: string
  content: string
  timestamp: number
}

export interface SessionMessage {
  id?: string
  role: MessageRole
  content: string
  timestamp: number
  reasoning?: string
  toolName?: string
  toolCallId?: string
  toolCalls?: ToolCallSummary[]
  toolResults?: ToolResultSummary[]
  error?: boolean
}

export interface CompletionFailure {
  message: string
  partial: boolean
}

/**
 * The gateway refuses a rewind to ordinal zero unless the client explicitly
 * confirms it. This mirrors desktop's first-turn edit/regenerate contract.
 */
export function truncateBeforeUserParams(userOrdinal: number): Record<string, number | boolean> {
  return {
    truncate_before_user_ordinal: userOrdinal,
    ...(userOrdinal === 0 ? { confirm_empty_truncate: true } : {}),
  }
}

/** The ordinal expected by gateway rewind parameters for a visible user turn. */
export function userOrdinalAtMessageIndex(messages: Pick<SessionMessage, 'role'>[], messageIndex: number): number | null {
  if (messages[messageIndex]?.role !== 'user') return null

  let ordinal = 0
  for (let index = 0; index < messageIndex; index++) {
    if (messages[index].role === 'user') ordinal++
  }
  return ordinal
}

/**
 * Desktop treats a `message.complete` event with status `error` as terminal,
 * even when the server retained a streamed partial response. Normalise the
 * several gateway error shapes before the websocket layer settles the turn.
 */
export function completionFailure(payload: unknown): CompletionFailure | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>
  if (record.status !== 'error') return null

  const structuredError = record.error
  const errorMessage = typeof structuredError === 'string'
    ? structuredError
    : structuredError && typeof structuredError === 'object' && typeof (structuredError as Record<string, unknown>).message === 'string'
      ? (structuredError as Record<string, unknown>).message as string
      : ''
  const message = errorMessage
    || (typeof record.failure_reason === 'string' ? record.failure_reason : '')
    || (typeof record.message === 'string' ? record.message : '')
    || 'Turn failed'

  return { message, partial: record.partial === true }
}

function textFromUnknown(value: unknown, depth = 0): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined || depth > 2) return ''

  if (Array.isArray(value)) {
    return value
      .filter((part): part is Record<string, unknown> => Boolean(part) && typeof part === 'object')
      .filter(part => part.type === 'text' || part.type === undefined)
      .map(part => textFromUnknown(part.text ?? part.content ?? part.output, depth + 1))
      .filter(Boolean)
      .join('\n')
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const text = textFromUnknown(
      record.text ?? record.output_text ?? record.output ?? record.content ?? record.message ?? record.summary ?? record.rendered,
      depth + 1,
    )
    if (text) return text
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }

  return String(value)
}

function stripTransportMarkup(text: string): string {
  return text
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<result>([\s\S]*?)<\/result>/gi, (_match, inner: string) => inner.trim())
    .trim()
}

// The gateway persists expanded @file/@folder context after the user's prose.
// Mirror desktop's compact transcript: retain refs not already visible, but do
// not render the full attached payload as if it were a user message.
const ATTACHED_CONTEXT_MARKER_RE = /(?:^|\n)--- Attached Context ---\s*\n/
const CONTEXT_WARNINGS_MARKER_RE = /(?:^|\n)--- Context Warnings ---[\s\S]*$/
const CONTEXT_REF_RE = /@(file|folder|url|image|tool|terminal):(?:"[^"\n]+"|'[^'\n]+'|`[^`\n]+`|\S+)/g

function displayContentForRole(role: MessageRole, text: string): string {
  if (role !== 'user') return text

  const withoutWarnings = text.replace(CONTEXT_WARNINGS_MARKER_RE, '').trim()
  const marker = withoutWarnings.match(ATTACHED_CONTEXT_MARKER_RE)
  if (!marker || marker.index === undefined) return withoutWarnings

  const visibleText = withoutWarnings.slice(0, marker.index).trim()
  const attachedContext = withoutWarnings.slice(marker.index + marker[0].length)
  const refs = [...new Set(Array.from(attachedContext.matchAll(CONTEXT_REF_RE)).map(match => match[0]))]
  const missingRefs = refs.filter(ref => !visibleText.includes(ref))

  return [missingRefs.join('\n'), visibleText].filter(Boolean).join('\n\n') || visibleText
}

function reasoningFromRaw(message: Record<string, unknown>): string {
  return textFromUnknown(message.reasoning_content ?? message.reasoning ?? message.reasoning_details).trim()
}

function toolCallsFromRaw(value: unknown): ToolCallSummary[] | undefined {
  if (!Array.isArray(value)) return undefined

  const calls = value
    .filter((call): call is Record<string, unknown> => Boolean(call) && typeof call === 'object')
    .map((call, index) => {
      const functionInfo = call.function as Record<string, unknown> | undefined
      const id = String(call.id ?? call.tool_call_id ?? `tool-call-${index}`)
      const name = String(call.name ?? call.tool_name ?? functionInfo?.name ?? 'tool')
      return { id, name }
    })

  return calls.length > 0 ? calls : undefined
}

function isVisible(message: Record<string, unknown>): boolean {
  const kind = message.display_kind
  return kind !== 'hidden' && kind !== 'model_switch' && kind !== 'auto_continue' && kind !== 'async_delegation_complete'
}

export function normalizeSessionMessages(rawMessages: unknown[]): SessionMessage[] {
  const messages = rawMessages
    .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object')
    .filter(isVisible)
    .flatMap((raw, index) => {
      const role = raw.role === 'tool' ? 'tool' : raw.role === 'user' ? 'user' : raw.role === 'assistant' ? 'assistant' : null
      if (!role) return []

      const content = displayContentForRole(role, stripTransportMarkup(textFromUnknown(raw.content)))
      const reasoning = role === 'assistant' ? reasoningFromRaw(raw) : ''
      const toolCalls = role === 'assistant' ? toolCallsFromRaw(raw.tool_calls) : undefined
      const toolName = role === 'tool' && typeof raw.tool_name === 'string' ? raw.tool_name : undefined
      const toolCallId = role === 'tool' && typeof raw.tool_call_id === 'string' ? raw.tool_call_id : undefined

      if (!content && !reasoning && !toolCalls?.length && role !== 'tool') return []

      const id = typeof raw.id === 'string' ? raw.id : `${role}-${index}`
      const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : 0
      const message: SessionMessage = {
        id,
        role,
        content,
        timestamp,
        ...(reasoning ? { reasoning } : {}),
        ...(toolName ? { toolName } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolCalls ? { toolCalls } : {}),
        ...(role === 'tool' ? {
          toolResults: [{ id, name: toolName || 'Tool', content, timestamp }],
        } : {}),
      }
      return [message]
    })

  return messages.reduce<SessionMessage[]>((grouped, message) => {
    const previous = grouped[grouped.length - 1]
    if (message.role === 'tool' && previous?.role === 'tool') {
      previous.toolResults = [
        ...(previous.toolResults || [{
          id: previous.id || 'tool',
          name: previous.toolName || 'Tool',
          content: previous.content,
          timestamp: previous.timestamp,
        }]),
        ...(message.toolResults || []),
      ]
      return grouped
    }

    grouped.push(message)
    return grouped
  }, [])
}

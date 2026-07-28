export type MessageRole = 'user' | 'assistant' | 'tool'

export interface ToolCallSummary {
  id: string
  name: string
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
  error?: boolean
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
  return rawMessages
    .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object')
    .filter(isVisible)
    .flatMap((raw, index) => {
      const role = raw.role === 'tool' ? 'tool' : raw.role === 'user' ? 'user' : raw.role === 'assistant' ? 'assistant' : null
      if (!role) return []

      const content = stripTransportMarkup(textFromUnknown(raw.content))
      const reasoning = role === 'assistant' ? reasoningFromRaw(raw) : ''
      const toolCalls = role === 'assistant' ? toolCallsFromRaw(raw.tool_calls) : undefined
      const toolName = role === 'tool' && typeof raw.tool_name === 'string' ? raw.tool_name : undefined
      const toolCallId = role === 'tool' && typeof raw.tool_call_id === 'string' ? raw.tool_call_id : undefined

      if (!content && !reasoning && !toolCalls?.length && role !== 'tool') return []

      return [{
        id: typeof raw.id === 'string' ? raw.id : `${role}-${index}`,
        role,
        content,
        timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : 0,
        ...(reasoning ? { reasoning } : {}),
        ...(toolName ? { toolName } : {}),
        ...(toolCallId ? { toolCallId } : {}),
        ...(toolCalls ? { toolCalls } : {}),
      }]
    })
}

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
  diff?: string
}

export interface ActivityThought {
  id: string
  content: string
  durationSeconds: number
}

export interface ImageAttachment {
  label: string
  src?: string
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
  activityThoughts?: ActivityThought[]
  imageAttachments?: ImageAttachment[]
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
const CONTEXT_COMPACTION_MARKER = '[CONTEXT COMPACTION — REFERENCE ONLY]'
const IMAGE_ATTACHMENT_HINT_RE = /(?:^|\n)\[Image attached(?: at)?:\s*([^\]\n]+)\]\s*/gi

function isPortableImageSource(value: string): boolean {
  return /^(?:https?:\/\/|data:image\/)/i.test(value.trim())
}

function imageAttachmentsFromRaw(content: unknown): ImageAttachment[] {
  const sources: string[] = []
  const visit = (value: unknown, depth = 0) => {
    if (depth > 3 || !value) return
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1))
      return
    }
    if (typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const imageUrl = record.image_url
    const src = typeof imageUrl === 'string'
      ? imageUrl
      : imageUrl && typeof imageUrl === 'object' && typeof (imageUrl as Record<string, unknown>).url === 'string'
        ? (imageUrl as Record<string, unknown>).url as string
        : typeof record.url === 'string' && (record.type === 'image' || record.type === 'image_url')
          ? record.url
          : ''
    if (src && isPortableImageSource(src)) sources.push(src.trim())
  }
  visit(content)

  const text = textFromUnknown(content)
  const localHints: string[] = []
  for (const match of text.matchAll(IMAGE_ATTACHMENT_HINT_RE)) {
    const source = match[1]?.trim() || ''
    if (isPortableImageSource(source)) sources.push(source)
    else if (source) localHints.push(source)
  }

  const attachments = [...new Set(sources)].map((src, index) => ({ label: `Image ${index + 1}`, src }))
  const unavailableCount = Math.max(0, localHints.length - attachments.length)
  return [...attachments, ...Array.from({ length: unavailableCount }, () => ({ label: 'Image attached' }))]
}

function displayContentForRole(role: MessageRole, text: string): string {
  if (role !== 'user') return text

  const withoutWarnings = text.replace(CONTEXT_WARNINGS_MARKER_RE, '').replace(IMAGE_ATTACHMENT_HINT_RE, '\n').trim()
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
  const content = textFromUnknown(message.content).trimStart()
  return kind !== 'hidden'
    && kind !== 'model_switch'
    && kind !== 'auto_continue'
    && kind !== 'async_delegation_complete'
    && !content.startsWith(CONTEXT_COMPACTION_MARKER)
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
      const inlineDiff = role === 'tool' && typeof raw.inline_diff === 'string' ? raw.inline_diff.trim() : ''
      const imageAttachments = role === 'user' ? imageAttachmentsFromRaw(raw.content) : []

      if (!content && !reasoning && !toolCalls?.length && role !== 'tool' && !imageAttachments.length) return []

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
        ...(imageAttachments.length ? { imageAttachments } : {}),
        ...(role === 'tool' ? {
          toolResults: [{ id, name: toolName || 'Tool', content, timestamp, ...(inlineDiff ? { diff: inlineDiff } : {}) }],
        } : {}),
      }
      return [message]
    })

  const grouped: SessionMessage[] = []

  for (let index = 0; index < messages.length;) {
    const message = messages[index]
    const isStructuralAssistant = message.role === 'assistant' && !message.content && Boolean(message.reasoning || message.toolCalls?.length)
    if (message.role !== 'tool' && !isStructuralAssistant) {
      grouped.push(message)
      index += 1
      continue
    }

    const run: SessionMessage[] = []
    while (index < messages.length) {
      const candidate = messages[index]
      const isStructural = candidate.role === 'tool'
        || (candidate.role === 'assistant' && !candidate.content && Boolean(candidate.reasoning || candidate.toolCalls?.length))
      if (!isStructural) break
      run.push(candidate)
      index += 1
    }

    const toolResults = run.flatMap(item => item.toolResults || [])
    if (run.length === 1 && toolResults.length === 0) {
      grouped.push(run[0])
      continue
    }

    const activityThoughts = run.flatMap((item, runIndex) => {
      if (!item.reasoning) return []
      const next = run[runIndex + 1]
      return [{
        id: item.id || `thought-${runIndex}`,
        content: item.reasoning,
        durationSeconds: next && next.timestamp > item.timestamp ? next.timestamp - item.timestamp : 0,
      }]
    })
    const first = run[0]
    const firstTool = run.find(item => item.role === 'tool')
    grouped.push({
      id: first.id,
      role: 'tool',
      content: toolResults.length === 1 ? toolResults[0].content : '',
      timestamp: first.timestamp,
      toolResults,
      ...(toolResults.length === 1 && firstTool?.toolName ? { toolName: firstTool.toolName } : {}),
      ...(toolResults.length === 1 && firstTool?.toolCallId ? { toolCallId: firstTool.toolCallId } : {}),
      ...(activityThoughts.length ? { activityThoughts } : {}),
    })
  }

  return grouped
}

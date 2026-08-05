export interface MessageTimelineSource {
  id?: string
  role: string
  content: string
  timestamp?: number
  imageAttachments?: readonly unknown[]
}

export interface MessageTimelineEntry {
  id: string
  messageIndex: number
  preview: string
  timestamp?: number
}

const PROCESS_NOTIFICATION_RE = /^\[IMPORTANT: Background process [\s\S]*\]$/
const DEFAULT_PREVIEW_MAX = 96

/** Keep a turn preview compact enough for a narrow timeline sheet. */
export function timelinePreview(text: string, max = DEFAULT_PREVIEW_MAX): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return `${collapsed.slice(0, max - 1).trimEnd()}…`
}

/**
 * Derive navigable turns from the visible transcript, matching Desktop's
 * timeline: human prompts are anchors, while injected process notices and
 * blank transport rows are not presented as conversation turns.
 */
export function deriveMessageTimeline(messages: readonly MessageTimelineSource[]): MessageTimelineEntry[] {
  const entries: MessageTimelineEntry[] = []

  messages.forEach((message, messageIndex) => {
    if (message.role !== 'user') return

    const content = message.content.trim()
    const attachmentCount = message.imageAttachments?.length || 0
    if (PROCESS_NOTIFICATION_RE.test(content)) return
    if (!content && attachmentCount === 0) return

    const preview = timelinePreview(content) || `${attachmentCount} image attachment${attachmentCount === 1 ? '' : 's'}`
    entries.push({
      id: message.id || `turn-${messageIndex}`,
      messageIndex,
      preview,
      ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
    })
  })

  return entries
}

/** Last turn whose anchor is at or above the transcript viewport. */
export function activeMessageTimelineIndex(offsets: readonly (number | null)[], slack = 32): number {
  let active = -1
  let firstRendered = -1

  for (let index = 0; index < offsets.length; index++) {
    const offset = offsets[index]
    if (offset === null) continue
    if (firstRendered === -1) firstRendered = index
    if (offset <= slack) active = index
  }

  return active === -1 ? (firstRendered === -1 ? 0 : firstRendered) : active
}

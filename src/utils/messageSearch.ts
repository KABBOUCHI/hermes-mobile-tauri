import type { SessionMessage } from './sessionMessages'

/**
 * Text that is actually exposed by the mobile transcript for a message.
 *
 * Tool activity and reasoning render outside `message.content`, so searching
 * only the primary field misses content that the reader can plainly see.
 * Keep this projection alongside the message model rather than coupling search
 * to the DOM or rendered markdown HTML.
 */
export function visibleMessageSearchText(message: Pick<SessionMessage, 'content' | 'reasoning' | 'toolCalls' | 'toolResults' | 'activityThoughts' | 'imageAttachments'>): string {
  const parts = [
    message.content,
    message.reasoning,
    ...(message.toolCalls || []).flatMap(call => [call.name]),
    ...(message.toolResults || []).flatMap(result => [result.name, result.content]),
    ...(message.activityThoughts || []).map(thought => thought.content),
    ...(message.imageAttachments || []).map(attachment => attachment.label),
  ]

  return parts
    .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
    .join('\n')
}

export function messageMatchesSearch(message: Parameters<typeof visibleMessageSearchText>[0], query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return Boolean(needle) && visibleMessageSearchText(message).toLocaleLowerCase().includes(needle)
}

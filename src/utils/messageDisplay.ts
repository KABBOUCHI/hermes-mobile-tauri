/**
 * Keep long user prompts readable without allowing one message to consume the
 * mobile transcript. Desktop uses a measured two-line clamp; mobile uses a
 * slightly more forgiving threshold because its message column is narrower.
 */
export const USER_MESSAGE_EXPANSION_CHAR_LIMIT = 240
export const USER_MESSAGE_EXPANSION_LINE_LIMIT = 5

export function shouldOfferMessageExpansion(content: string): boolean {
  const text = content.trim()
  if (!text) return false

  return text.length > USER_MESSAGE_EXPANSION_CHAR_LIMIT
    || text.split(/\r?\n/).length > USER_MESSAGE_EXPANSION_LINE_LIMIT
}

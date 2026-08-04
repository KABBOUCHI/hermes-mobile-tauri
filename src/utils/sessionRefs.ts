/**
 * Pure helpers for Desktop-compatible `@session:<profile>/<id>` references.
 *
 * The desktop renderer turns these references into internal links instead of
 * leaving transport syntax in the transcript. Mobile uses a hash fragment so
 * the existing markdown renderer can carry the value safely to the view.
 */
export const SESSION_REF_RE = /(?<![\w/])(?<!]\()@session:(`[^`\n]+`|"[^"\n]+"|'[^'\n]+'|\S+)/g

const TRAILING_PUNCTUATION_RE = /[,.;:!?)\]}]+$/

function unwrapQuotes(raw: string): string | null {
  if (raw.length < 2) return null

  const head = raw[0]
  const tail = raw[raw.length - 1]
  if (
    (head === '`' && tail === '`')
    || (head === '"' && tail === '"')
    || (head === "'" && tail === "'")
  ) {
    return raw.slice(1, -1)
  }

  return null
}

export function splitSessionRefValue(raw: string): { trailing: string; value: string } {
  const quoted = unwrapQuotes(raw)
  if (quoted !== null) return { trailing: '', value: quoted }

  const value = raw.replace(TRAILING_PUNCTUATION_RE, '')
  return { trailing: raw.slice(value.length), value }
}

/** A slash separates an optional profile from the durable session ID. */
export function parseSessionRefValue(value: string): { profile?: string; sessionId: string } {
  const trimmed = value.trim()
  const slash = trimmed.indexOf('/')
  if (slash === -1) return { sessionId: trimmed }

  const profile = trimmed.slice(0, slash).trim()
  const sessionId = trimmed.slice(slash + 1).trim()
  return sessionId ? { profile: profile || undefined, sessionId } : { sessionId: trimmed }
}

export function sessionRefFallbackLabel(value: string): string {
  const { sessionId } = parseSessionRefValue(value)
  if (!sessionId) return value
  return sessionId.length > 10 ? `${sessionId.slice(0, 8)}…` : sessionId
}

export function sessionMarkdownHref(value: string): string {
  return `#session/${encodeURIComponent(value)}`
}

export function sessionRefFromMarkdownHref(href?: string): string | null {
  if (!href?.startsWith('#session/')) return null
  try {
    return decodeURIComponent(href.slice('#session/'.length)) || null
  } catch {
    return null
  }
}

/**
 * Rewrite only bare references. Code spans and fenced blocks are excluded by
 * the caller, matching Desktop's markdown preprocessor contract.
 */
export function linkifySessionRefs(
  text: string,
  labelFor?: (value: string) => string,
): string {
  if (!text.includes('@session:')) return text

  return text.replace(SESSION_REF_RE, (match, raw: string) => {
    const { trailing, value } = splitSessionRefValue(raw)
    if (!parseSessionRefValue(value).sessionId) return match

    const label = (labelFor?.(value) || sessionRefFallbackLabel(value)).replace(/[\[\]\\]/g, '\\$&')
    return `[${label}](${sessionMarkdownHref(value)})${trailing}`
  })
}

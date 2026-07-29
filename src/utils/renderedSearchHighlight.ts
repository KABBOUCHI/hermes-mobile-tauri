/**
 * Adds search marks only to rendered text nodes represented in an HTML string.
 *
 * The markdown renderer intentionally returns HTML. A whole-string replacement
 * can also match tag names and attributes (for example, searching "a" mutates
 * `<a class=…>`), producing malformed markup. Keep tags and HTML entities
 * intact, while highlighting the visible text between them.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightTextSegment(segment: string, matcher: RegExp): string {
  // Do not split an entity such as `&amp;`; it represents one visible character
  // and must remain valid HTML after highlighting.
  return segment
    .split(/(&(?:#\d+|#x[\da-f]+|[a-z][\da-z]*);)/gi)
    .map(part => part.startsWith('&') && part.endsWith(';') ? part : part.replace(matcher, '<mark class="search-highlight">$1</mark>'))
    .join('')
}

export function highlightRenderedHtml(html: string, query: string): string {
  const needle = query.trim()
  if (!needle || !html) return html

  const matcher = new RegExp(`(${escapeRegExp(needle)})`, 'gi')
  // Markdown output does not contain literal angle brackets in text: they are
  // escaped by renderMarkdown, so this safely separates tags from text.
  return html
    .split(/(<[^>]*>)/g)
    .map(part => part.startsWith('<') && part.endsWith('>') ? part : highlightTextSegment(part, matcher))
    .join('')
}

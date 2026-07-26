/**
 * Lightweight markdown → HTML renderer for chat messages.
 * Handles: code blocks, inline code, bold, italic, strikethrough,
 * links, headers, horizontal rules, unordered/ordered lists, blockquotes.
 * No dependencies.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ESCAPE_MAP[c])
}

function parseInline(text: string): string {
  // inline code (must come first to prevent inner parsing)
  let result = text.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>')
  // images
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-img" />')
  // links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link" target="_blank" rel="noopener">$1</a>')
  // bold + italic
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  // bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>')
  // italic
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>')
  result = result.replace(/_(.+?)_/g, '<em>$1</em>')
  // strikethrough
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>')
  return result
}

export function renderMarkdown(raw: string): string {
  if (!raw) return ''

  const lines = raw.split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // fenced code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(escapeHtml(lines[i]))
        i++
      }
      i++ // skip closing ```
      const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : ''
      out.push(`<pre class="md-code-block"${langAttr}><code>${codeLines.join('\n')}</code></pre>`)
      continue
    }

    // horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(line.trim())) {
      out.push('<hr class="md-hr" />')
      i++
      continue
    }

    // headers
    const headerMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (headerMatch) {
      const level = headerMatch[1].length
      out.push(`<h${level} class="md-h${level}">${parseInline(headerMatch[2])}</h${level}>`)
      i++
      continue
    }

    // blockquote
    if (line.trimStart().startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      out.push(`<blockquote class="md-quote">${parseInline(quoteLines.join('\n'))}</blockquote>`)
      continue
    }

    // unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^[\s]*[-*+]\s/, '')))
        i++
      }
      out.push(`<ul class="md-ul">${items.map(t => `<li>${t}</li>`).join('')}</ul>`)
      continue
    }

    // ordered list
    if (/^[\s]*\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[\s]*\d+\.\s/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^[\s]*\d+\.\s/, '')))
        i++
      }
      out.push(`<ol class="md-ol">${items.map(t => `<li>${t}</li>`).join('')}</ol>`)
      continue
    }

    // blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // paragraph — collect consecutive non-empty lines
    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' &&
      !lines[i].trimStart().startsWith('```') &&
      !lines[i].trimStart().startsWith('>') &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^(\*{3,}|-{3,}|_{3,})\s*$/.test(lines[i].trim()) &&
      !/^[\s]*[-*+]\s/.test(lines[i]) &&
      !/^[\s]*\d+\.\s/.test(lines[i])) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      out.push(`<p class="md-p">${parseInline(paraLines.join('\n'))}</p>`)
    }
  }

  return out.join('\n')
}

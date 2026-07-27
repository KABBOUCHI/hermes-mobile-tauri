/**
 * Lightweight markdown → HTML renderer with thinking blocks and code copy.
 * Zero dependencies — designed for AI chat on mobile.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Auto-link bare URLs that aren't already inside markdown link syntax.
 * Follows the desktop app's approach in markdown-preprocess.ts:
 * wraps bare https:// URLs in angle brackets so the markdown renderer
 * treats them as autolinks. Excludes URLs preceded by < or ](
 * to avoid double-wrapping existing links.
 */
function autoLinkRawUrls(text: string): string {
  // Match bare URLs: http:// or https:// followed by non-space characters.
  // Exclude trailing punctuation that's likely sentence-ending, not part of the URL.
  return text.replace(/https?:\/\/[^\s<>"'`*]+[^\s<>"'`*.,;:!?)]/g, (url, index) => {
    const prev = text[index - 1] || ''
    const prevPrev = text[index - 2] || ''

    // Skip if already inside an angle bracket or markdown link
    if (prev === '<') return url
    if (prevPrev === ']' && prev === '(') return url

    return `<${url}>`
  })
}

function renderInline(text: string): string {
  let out = escapeHtml(text)

  // Inline code (must be before other inline rules)
  out = out.replace(/`([^`\\n]+?)`/g, '<code class="md-inline">$1</code>')

  // Images
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy" />')

  // Markdown links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="md-link" href="$2" target="_blank" rel="noopener">$1</a>')

  // Auto-link bare URLs (before bold/italic so they don't break URLs with underscores)
  out = autoLinkRawUrls(out)

  // Bold
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__(.+?)__/g, '<strong>$1</strong>')

  // Italic
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>')
  out = out.replace(/_(.+?)_/g, '<em>$1</em>')

  // Strikethrough
  out = out.replace(/~~(.+?)~~/g, '<del>$1</del>')

  return out
}

function renderTableRows(lines: string[]): string {
  if (lines.length < 2) return lines.map(l => `<tr><td>${renderInline(l)}</td></tr>`).join('')

  const header = lines[0].split('|').map(c => c.trim()).filter(Boolean)
  const rows = lines.slice(2) // skip header + separator

  let html = '<table class="md-table"><thead><tr>'
  header.forEach(h => { html += `<th>${renderInline(h)}</th>` })
  html += '</tr></thead><tbody>'
  rows.forEach(row => {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean)
    html += '<tr>'
    cells.forEach(c => { html += `<td>${renderInline(c)}</td>` })
    html += '</tr>'
  })
  html += '</tbody></table>'
  return html
}

export function renderMarkdown(text: string): string {
  if (!text) return ''

  // Strip <think>...</think> tags — render as thinking block
  const thinkingBlocks: string[] = []
  let cleaned = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, content) => {
    thinkingBlocks.push(
      `<details class="md-thinking" open>` +
      `<summary class="md-thinking-label">Thinking</summary>` +
      `<div class="md-thinking-content">${renderInline(content.trim())}</div>` +
      `</details>`
    )
    return `%%THINKING_BLOCK_${thinkingBlocks.length - 1}%%`
  })

  // Handle open <think> tags (streaming — no closing tag yet)
  cleaned = cleaned.replace(/<think>([\s\S]*?)$/gi, (_m, content) => {
    thinkingBlocks.push(
      `<div class="md-thinking md-thinking-streaming">` +
      `<div class="md-thinking-label">Thinking…</div>` +
      `<div class="md-thinking-content">${renderInline(content.trim())}</div>` +
      `</div>`
    )
    return `%%THINKING_BLOCK_${thinkingBlocks.length - 1}%%`
  })

  // Strip reasoning tags too
  cleaned = cleaned.replace(/<reasoning>([\s\S]*?)<\/reasoning>/gi, '')

  const lines = cleaned.split('\n')
  const blocks: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Placeholder for thinking block
    const thinkMatch = line.match(/^%%THINKING_BLOCK_(\d+)%%$/)
    if (thinkMatch) {
      blocks.push(thinkingBlocks[parseInt(thinkMatch[1])])
      i++
      continue
    }

    // Empty line
    if (line.trim() === '') {
      i++
      continue
    }

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch) {
      const lang = fenceMatch[1] || ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      const langLabel = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : ''
      blocks.push(
        `<div class="md-code-wrap">` +
        `<div class="md-code-header">${langLabel}` +
        `<button class="md-code-copy">Copy</button>` +
        `</div>` +
        `<pre class="md-code-block"><code>${codeLines.map(escapeHtml).join('\n')}</code></pre>` +
        `</div>`
      )
      continue
    }

    // Table (consecutive lines with |)
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\|?\s*[-:]+/)) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i++
      }
      blocks.push(renderTableRows(tableLines))
      continue
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.+)/)
    if (headerMatch) {
      const level = headerMatch[1].length
      blocks.push(`<div class="md-h${level}">${renderInline(headerMatch[2])}</div>`)
      i++
      continue
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push(`<blockquote class="md-quote">${renderInline(quoteLines.join('\n'))}</blockquote>`)
      continue
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}\s*$/)) {
      blocks.push('<hr class="md-hr" />')
      i++
      continue
    }

    // Unordered list
    if (line.match(/^[\s]*[-*+]\s/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^[\s]*[-*+]\s/)) {
        const checked = lines[i].match(/^\s*[-*+]\s\[([ xX])\]\s/)
        if (checked) {
          const isChecked = checked[1] !== ' '
          items.push(`<li class="md-task"><input type="checkbox" ${isChecked ? 'checked' : ''} disabled /> ${renderInline(lines[i].replace(/^\s*[-*+]\s\[[ xX]\]\s/, ''))}</li>`)
        } else {
          items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*+]\s/, ''))}</li>`)
        }
        i++
      }
      blocks.push(`<ul class="md-ul">${items.join('')}</ul>`)
      continue
    }

    // Ordered list
    if (line.match(/^\d+\.\s/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) {
        items.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s/, ''))}</li>`)
        i++
      }
      blocks.push(`<ol class="md-ol">${items.join('')}</ol>`)
      continue
    }

    // Paragraph (collect consecutive non-empty lines)
    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^(#{1,6}\s|```|>\s|[-*_]{3,}|\|)/) && !lines[i].match(/^%%THINKING_BLOCK_/)) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      blocks.push(`<p class="md-p">${renderInline(paraLines.join(' '))}</p>`)
    }
  }

  return blocks.join('\n')
}

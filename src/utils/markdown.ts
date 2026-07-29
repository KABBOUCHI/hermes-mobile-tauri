/**
 * Lightweight markdown → HTML renderer with thinking blocks and code copy.
 * Uses highlight.js for syntax highlighting of fenced code blocks.
 */
import hljs from 'highlight.js/lib/core'

// Register common languages (lightweight subset)
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import json from 'highlight.js/lib/languages/json'
import xml from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import markdown from 'highlight.js/lib/languages/markdown'
import yaml from 'highlight.js/lib/languages/yaml'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import ruby from 'highlight.js/lib/languages/ruby'
import php from 'highlight.js/lib/languages/php'
import swift from 'highlight.js/lib/languages/swift'
import kotlin from 'highlight.js/lib/languages/kotlin'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import ini from 'highlight.js/lib/languages/ini'
import toml from 'highlight.js/lib/languages/ini'  // TOML uses ini grammar
import lua from 'highlight.js/lib/languages/lua'
import r from 'highlight.js/lib/languages/r'
import matlab from 'highlight.js/lib/languages/matlab'
import graphql from 'highlight.js/lib/languages/graphql'
import http from 'highlight.js/lib/languages/http'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('jsx', javascript)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('tsx', typescript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('css', css)
hljs.registerLanguage('json', json)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('zsh', bash)
hljs.registerLanguage('shell', shell)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('rs', rust)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('c', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('cs', csharp)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('rb', ruby)
hljs.registerLanguage('php', php)
hljs.registerLanguage('swift', swift)
hljs.registerLanguage('kotlin', kotlin)
hljs.registerLanguage('kt', kotlin)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('dockerfile', dockerfile)
hljs.registerLanguage('docker', dockerfile)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('toml', toml)
hljs.registerLanguage('lua', lua)
hljs.registerLanguage('r', r)
hljs.registerLanguage('matlab', matlab)
hljs.registerLanguage('graphql', graphql)
hljs.registerLanguage('gql', graphql)
hljs.registerLanguage('http', http)

/** Try to highlight code with highlight.js, fall back to plain text */
function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch { /* fall through */ }
  }
  // Auto-detect if no language specified
  if (!lang) {
    try {
      const result = hljs.highlightAuto(code, [
        'javascript', 'typescript', 'python', 'css', 'json',
        'bash', 'sql', 'rust', 'go', 'java', 'cpp', 'ruby',
      ])
      // Only use auto-detect if confidence is reasonable
      if (result.language && result.relevance > 3) {
        return result.value
      }
    } catch { /* fall through */ }
  }
  return escapeHtml(code)
}

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

    // Explicit markdown links and images have already been rendered into HTML.
    // Leave URLs in their attributes untouched rather than nesting anchors.
    if (prev === '<' || prev === '"' || prev === "'" || prev === '=' || (prevPrev === ']' && prev === '(')) return url

    return `<a class="md-link" href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
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
      const rawCode = codeLines.join('\n')
      const highlighted = highlightCode(rawCode, lang)
      const langLabel = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : ''
      blocks.push(
        `<div class="md-code-wrap">` +
        `<div class="md-code-header">${langLabel}` +
        `<button class="md-code-copy">Copy</button>` +
        `</div>` +
        `<pre class="md-code-block"><code class="hljs">${highlighted}</code></pre>` +
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
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^(#{1,6}\s|```|>\s|[-*_]{3,}\s*$)/) && !lines[i].match(/^%%THINKING_BLOCK_/)) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      blocks.push(`<p class="md-p">${renderInline(paraLines.join(' '))}</p>`)
    }
  }

  return blocks.join('\n')
}

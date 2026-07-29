import { describe, expect, it } from 'vitest'
import { highlightRenderedHtml } from './renderedSearchHighlight'

describe('highlightRenderedHtml', () => {
  it('marks visible text without changing HTML tags or attributes', () => {
    const html = '<p><a class="md-link" href="https://example.com">A link</a></p>'

    expect(highlightRenderedHtml(html, 'a')).toBe(
      '<p><a class="md-link" href="https://example.com"><mark class="search-highlight">A</mark> link</a></p>',
    )
  })

  it('does not split escaped HTML entities while highlighting nearby text', () => {
    const html = '<p>Fish &amp; chips</p>'

    expect(highlightRenderedHtml(html, 'chips')).toBe(
      '<p>Fish &amp; <mark class="search-highlight">chips</mark></p>',
    )
  })
})

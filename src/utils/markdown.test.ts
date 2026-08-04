import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown links', () => {
  it('renders bare http URLs as external links', () => {
    const html = renderMarkdown('Read https://hermes-agent.nousresearch.com/docs today.')

    expect(html).toContain('class="md-link"')
    expect(html).toContain('href="https://hermes-agent.nousresearch.com/docs"')
    expect(html).toContain('>https://hermes-agent.nousresearch.com/docs</a>')
    expect(html).not.toContain('docs</a> today.</a>')
  })

  it('does not nest a link inside explicit markdown-link attributes', () => {
    const html = renderMarkdown('[Hermes docs](https://hermes-agent.nousresearch.com/docs)')

    expect(html).toContain('href="https://hermes-agent.nousresearch.com/docs"')
    expect(html.match(/class="md-link"/g)).toHaveLength(1)
  })

  it('marks desktop preview actions for mobile click handling', () => {
    const html = renderMarkdown('[Preview: guide](#preview/https%3A%2F%2Fexample.com%2Fguide)')

    expect(html).toContain('class="md-link md-preview-link"')
    expect(html).toContain('href="#preview/https%3A%2F%2Fexample.com%2Fguide"')
  })

  it('renders session references as internal links without touching inline code', () => {
    const html = renderMarkdown('Open @session:work/20260729_120000_abc123, but keep `@session:work/abc` as code.')

    expect(html).toContain('class="md-link md-session-link"')
    expect(html).toContain('href="#session/work%2F20260729_120000_abc123"')
    expect(html).toContain('>20260729…</a>')
    expect(html).toContain('<code class="md-inline">@session:work/abc</code>')
  })

  it('renders a pipe-prefixed non-table line as a paragraph', () => {
    expect(renderMarkdown('| status output, not a markdown table')).toBe(
      '<p class="md-p">| status output, not a markdown table</p>',
    )
  })

  it('renders a rule-prefixed non-rule line as a paragraph', () => {
    expect(renderMarkdown('--- Attached Context ---')).toBe(
      '<p class="md-p">--- Attached Context ---</p>',
    )
  })
})

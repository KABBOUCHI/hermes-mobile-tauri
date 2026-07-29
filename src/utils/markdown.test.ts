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

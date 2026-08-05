import { describe, expect, it } from 'vitest'
import { renderMarkdown, renderMediaTags } from './markdown'

describe('renderMarkdown links', () => {
  it('converts desktop MEDIA tags into typed attachment links', () => {
    expect(renderMediaTags(`here
MEDIA:/tmp/voice.mp3
there`)).toBe(
      `here
[Audio: voice.mp3](#media:%2Ftmp%2Fvoice.mp3)
there`,
    )
    expect(renderMediaTags('MEDIA:"/tmp/my recording.mp4"')).toBe(
      '[Video: my recording.mp4](#media:%2Ftmp%2Fmy%20recording.mp4)',
    )
  })

  it('renders a portable MEDIA audio tag with native controls', () => {
    const html = renderMarkdown('MEDIA:https://cdn.example/voice.mp3')

    expect(html).toContain('class="md-media md-media-audio"')
    expect(html).toContain('<audio class="md-audio" controls')
    expect(html).toContain('src="https://cdn.example/voice.mp3"')
  })

  it('marks gateway-local MEDIA attachments for mobile fallback handling', () => {
    const html = renderMarkdown('MEDIA:/tmp/voice.mp3')

    expect(html).toContain('class="md-link md-media-link"')
    expect(html).toContain('href="#media:%2Ftmp%2Fvoice.mp3"')
  })

  it('renders a portable video markdown link with native controls', () => {
    const html = renderMarkdown('[Watch clip](https://cdn.example/demo.webm)')

    expect(html).toContain('class="md-media md-media-video"')
    expect(html).toContain('<video class="md-video" controls')
    expect(html).toContain('src="https://cdn.example/demo.webm"')
  })

  it('keeps MEDIA-looking text inside inline code untouched', () => {
    const html = renderMarkdown('Use `MEDIA:/tmp/voice.mp3` as a debug marker.')

    expect(html).toContain('<code class="md-inline">MEDIA:/tmp/voice.mp3</code>')
    expect(html).not.toContain('md-media')
  })

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

  it('supports tilde fences and info-string metadata', () => {
    const html = renderMarkdown('~~~typescript title="app.ts"\nconst value = 1\n~~~')

    expect(html).toContain('<span class="md-code-lang">typescript</span>')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
    expect(html).not.toContain('<p class="md-p">~~~')
  })

  it('accepts punctuation-heavy language names through highlight aliases', () => {
    const html = renderMarkdown('```c++\nstd::vector<int> values;\n```')

    expect(html).toContain('<span class="md-code-lang">c++</span>')
    expect(html).toContain('<span class="hljs-type">int</span>')
  })

  it('does not close a longer fence on an inner shorter fence', () => {
    const html = renderMarkdown('````text\n```\ninside\n```\n````')

    expect(html.match(/class="md-code-wrap"/g)).toHaveLength(1)
    expect(html).toContain('inside')
  })
})

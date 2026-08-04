import { describe, expect, it } from 'vitest'
import { previewName, previewTargetFromMarkdownHref } from './previewTargets'

describe('preview target links', () => {
  it('decodes an encoded preview target from the desktop markdown href', () => {
    expect(previewTargetFromMarkdownHref('#preview/https%3A%2F%2Fexample.com%2Fguide')).toBe('https://example.com/guide')
  })

  it('rejects ordinary and malformed links', () => {
    expect(previewTargetFromMarkdownHref('https://example.com')).toBeNull()
    expect(previewTargetFromMarkdownHref('#preview/%E0%A4%A')).toBeNull()
  })

  it('uses a readable label for remote and local targets', () => {
    expect(previewName('https://example.com/guide')).toBe('guide')
    expect(previewName('file:///tmp/report.md')).toBe('report.md')
  })
})

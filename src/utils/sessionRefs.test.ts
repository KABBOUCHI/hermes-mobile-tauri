import { describe, expect, it } from 'vitest'
import {
  linkifySessionRefs,
  parseSessionRefValue,
  sessionMarkdownHref,
  sessionRefFallbackLabel,
  sessionRefFromMarkdownHref,
  splitSessionRefValue,
} from './sessionRefs'

describe('session references', () => {
  it('parses optional profile and durable id', () => {
    expect(parseSessionRefValue('work/20260729_120000_abc123')).toEqual({
      profile: 'work',
      sessionId: '20260729_120000_abc123',
    })
    expect(parseSessionRefValue('20260729_120000_abc123')).toEqual({
      sessionId: '20260729_120000_abc123',
    })
  })

  it('keeps punctuation outside the reference link', () => {
    expect(splitSessionRefValue('work/abc123,')).toEqual({ value: 'work/abc123', trailing: ',' })
    expect(splitSessionRefValue('`work/session with spaces`')).toEqual({ value: 'work/session with spaces', trailing: '' })
  })

  it('uses a short fallback label and a reversible fragment href', () => {
    const value = 'work/20260729_120000_abc123'
    expect(sessionRefFallbackLabel(value)).toBe('20260729…')
    expect(sessionRefFromMarkdownHref(sessionMarkdownHref(value))).toBe(value)
  })

  it('linkifies bare references without rewriting ordinary email-like text', () => {
    const htmlSource = linkifySessionRefs('See @session:work/20260729_120000_abc123 next.')
    expect(htmlSource).toBe('See [20260729…](#session/work%2F20260729_120000_abc123) next.')
    expect(linkifySessionRefs('mail foo@session:work/abc')).toBe('mail foo@session:work/abc')
  })

  it('does not rewrite a reference already inside a markdown link', () => {
    expect(linkifySessionRefs('[existing](@session:work/abc)')).toBe('[existing](@session:work/abc)')
  })
})

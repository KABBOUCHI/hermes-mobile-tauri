import { describe, expect, it } from 'vitest'
import { createSessionExport } from './sessionExport'

describe('createSessionExport', () => {
  it('creates the portable session payload and a sanitized desktop-compatible filename', () => {
    const exported = createSessionExport({
      sessionId: '01H-ABC-DEF',
      title: '  Build: API / mobile  ',
      session: { id: '01H-ABC-DEF', model: 'openai/gpt-5' },
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
      exportedAt: '2026-07-29T10:00:00.000Z',
    })

    expect(exported.fileName).toBe('build-api-mobile-01h-abc.json')
    expect(JSON.parse(exported.serialized)).toEqual({
      exported_at: '2026-07-29T10:00:00.000Z',
      session_id: '01H-ABC-DEF',
      title: 'Build: API / mobile',
      session: { id: '01H-ABC-DEF', model: 'openai/gpt-5' },
      message_count: 1,
      messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
    })
  })

  it('falls back to a safe filename and title for draft sessions', () => {
    const exported = createSessionExport({
      sessionId: '',
      title: '',
      session: null,
      messages: [],
      exportedAt: '2026-07-29T10:00:00.000Z',
    })

    expect(exported.fileName).toBe('session-chat.json')
    expect(JSON.parse(exported.serialized)).toMatchObject({
      session_id: null,
      title: 'Hermes Chat',
      message_count: 0,
    })
  })
})

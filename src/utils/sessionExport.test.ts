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

describe('chooseSessionExportDelivery', () => {
  it('prefers a shareable file, then text sharing, then clipboard', async () => {
    const { chooseSessionExportDelivery } = await import('./sessionExport')

    expect(chooseSessionExportDelivery({ canShareFiles: true, canShareText: true, hasClipboard: true })).toBe('file')
    expect(chooseSessionExportDelivery({ canShareFiles: false, canShareText: true, hasClipboard: true })).toBe('text')
    expect(chooseSessionExportDelivery({ canShareFiles: false, canShareText: false, hasClipboard: true })).toBe('clipboard')
    expect(chooseSessionExportDelivery({ canShareFiles: false, canShareText: false, hasClipboard: false })).toBe('unavailable')
  })
})

describe('deliverSessionExport', () => {
  const artifact = { fileName: 'chat-01.json', serialized: '{"messages":[]}' }
  const makeFile = (serialized: string, fileName: string) => ({ name: fileName, type: `application/json:${serialized}` })

  it('shares the complete JSON file when native file sharing is available', async () => {
    const { deliverSessionExport } = await import('./sessionExport')
    let shared: any = null

    const result = await deliverSessionExport(
      artifact,
      'Chat',
      {
        canShare: () => true,
        share: async payload => { shared = payload },
      },
      makeFile,
    )

    expect(result).toBe('file')
    expect(shared).toEqual({ title: 'Chat', files: [{ name: 'chat-01.json', type: 'application/json:{"messages":[]}' }] })
  })

  it('falls back to the complete JSON clipboard when sharing fails', async () => {
    const { deliverSessionExport } = await import('./sessionExport')
    let copied = ''

    const result = await deliverSessionExport(
      artifact,
      'Chat',
      {
        share: async () => { throw new Error('share unavailable') },
        clipboard: { writeText: async text => { copied = text } },
      },
      makeFile,
    )

    expect(result).toBe('clipboard')
    expect(copied).toBe(artifact.serialized)
  })

  it('does not treat an intentional share cancellation as a failed export', async () => {
    const { deliverSessionExport } = await import('./sessionExport')

    const result = await deliverSessionExport(
      artifact,
      'Chat',
      { share: async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) } },
      makeFile,
    )

    expect(result).toBe('cancelled')
  })
})

import { describe, expect, it } from 'vitest'
import { sharedDraftToComposer, normalizeSharedDraft } from './sharedDraft'

describe('shared drafts', () => {
  it('normalizes text, subject, and safe attachment metadata from Android', () => {
    const draft = normalizeSharedDraft({
      subject: 'Interesting article',
      text: 'https://example.com/story',
      files: [{ name: 'photo.png', mimeType: 'image/png', base64: 'cGl4ZWxz', size: 6 }],
    })

    expect(draft).toEqual({
      text: 'https://example.com/story',
      subject: 'Interesting article',
      files: [{ name: 'photo.png', mimeType: 'image/png', base64: 'cGl4ZWxz', size: 6 }],
    })
    expect(sharedDraftToComposer(draft!)).toMatchObject({
      text: 'Interesting article\n\nhttps://example.com/story',
      attachments: [expect.objectContaining({ name: 'photo.png', kind: 'image', dataUrl: 'data:image/png;base64,cGl4ZWxz' })],
    })
  })

  it('drops malformed and oversized files without discarding the shared text', () => {
    const draft = normalizeSharedDraft({
      text: 'Read this',
      files: [
        { name: '../not-a-file', mimeType: 'text/plain', base64: 'bad value', size: 4 },
        { name: 'too-big.zip', mimeType: 'application/zip', base64: 'cGl4ZWxz', size: 16 * 1024 * 1024 + 1 },
      ],
    })

    expect(draft).toEqual({ text: 'Read this', subject: '', files: [] })
  })

  it('limits the Android payload to the composer attachment limit', () => {
    const draft = normalizeSharedDraft({
      files: Array.from({ length: 6 }, (_, index) => ({
        name: `file-${index}.txt`, mimeType: 'text/plain', base64: 'dGVzdA==', size: 4,
      })),
    })

    expect(draft?.files).toHaveLength(4)
  })
})

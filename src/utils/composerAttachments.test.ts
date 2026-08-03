import { describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  attachmentError,
  attachmentKind,
  base64FromDataUrl,
  buildAttachmentPrompt,
} from './composerAttachments'

describe('composerAttachments', () => {
  it('classifies images by MIME type or filename', () => {
    expect(attachmentKind('photo.bin', 'image/png')).toBe('image')
    expect(attachmentKind('photo.jpg', '')).toBe('image')
    expect(attachmentKind('report.pdf', 'application/pdf')).toBe('file')
  })

  it('enforces the desktop attachment limits', () => {
    expect(attachmentError('too-large.bin', MAX_ATTACHMENT_BYTES + 1, 0)).toContain('16 MB')
    expect(attachmentError('fourth.txt', 1, MAX_ATTACHMENTS)).toContain('up to 4')
    expect(attachmentError('ok.txt', 1, 0)).toBeNull()
  })

  it('extracts the payload from a data URL', () => {
    expect(base64FromDataUrl('data:text/plain;base64,SGVsbG8=')).toBe('SGVsbG8=')
    expect(base64FromDataUrl('SGVsbG8=')).toBe('SGVsbG8=')
  })

  it('builds prompt text with file refs and image fallback text', () => {
    expect(buildAttachmentPrompt('Inspect these', ['@file:report.pdf'], 0)).toBe('@file:report.pdf\n\nInspect these')
    expect(buildAttachmentPrompt('', [], 1)).toBe('What do you see in this image?')
    expect(buildAttachmentPrompt('  ', [], 0)).toBe('')
  })
})

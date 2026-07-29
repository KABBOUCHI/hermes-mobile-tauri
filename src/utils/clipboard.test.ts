import { describe, expect, it, vi } from 'vitest'
import { writeClipboardText, type ClipboardWriter } from './clipboard'

describe('writeClipboardText', () => {
  it('writes non-empty text through the supplied clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    await expect(writeClipboardText('Copy me', { writeText } as ClipboardWriter)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('Copy me')
  })

  it('returns false when clipboard access is unavailable or rejected', async () => {
    await expect(writeClipboardText('Copy me', undefined)).resolves.toBe(false)
    await expect(writeClipboardText('Copy me', {
      writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
    } as ClipboardWriter)).resolves.toBe(false)
  })

  it('does not call the clipboard for empty text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    await expect(writeClipboardText('', { writeText } as ClipboardWriter)).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})

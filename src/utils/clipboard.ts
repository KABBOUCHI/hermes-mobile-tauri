export type ClipboardWriter = Pick<Clipboard, 'writeText'>

/**
 * A clipboard write is a progressive enhancement on mobile: Android WebViews
 * can deny it even after a direct user gesture. Keep that failure local so the
 * message action sheet can offer clear feedback rather than leaving an
 * unhandled rejection behind.
 */
export async function writeClipboardText(text: string, clipboard: ClipboardWriter | undefined = navigator.clipboard): Promise<boolean> {
  if (!text || !clipboard?.writeText) return false

  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export type ComposerAttachmentKind = 'image' | 'file'

export interface PendingAttachment {
  id: string
  kind: ComposerAttachmentKind
  name: string
  mimeType: string
  dataUrl: string
  size: number
  attachedRuntimeId?: string
  refText?: string
}

export const MAX_ATTACHMENT_BYTES = 16 * 1024 * 1024
export const MAX_ATTACHMENTS = 4

const IMAGE_EXTENSIONS = /\.(?:avif|gif|jpe?g|png|webp)$/i

export function attachmentKind(name: string, mimeType: string): ComposerAttachmentKind {
  return mimeType.toLowerCase().startsWith('image/') || IMAGE_EXTENSIONS.test(name) ? 'image' : 'file'
}

export function attachmentError(
  name: string,
  size: number,
  count: number,
): string | null {
  if (count >= MAX_ATTACHMENTS) return `You can attach up to ${MAX_ATTACHMENTS} files`
  if (size > MAX_ATTACHMENT_BYTES) return `${name} is too large (max 16 MB)`
  return null
}

export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

export function buildAttachmentPrompt(
  text: string,
  fileRefs: readonly string[],
  imageCount: number,
): string {
  return [
    ...fileRefs.filter(Boolean),
    text.trim(),
  ].filter(Boolean).join('\n\n') || (imageCount > 0 ? 'What do you see in this image?' : '')
}

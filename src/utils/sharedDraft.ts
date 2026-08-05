import { attachmentKind, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, type PendingAttachment } from './composerAttachments'

export interface SharedDraftFile {
  name: string
  mimeType: string
  base64: string
  size: number
}

export interface SharedDraft {
  text: string
  subject: string
  files: SharedDraftFile[]
}

interface RawSharedDraftFile {
  name?: unknown
  mimeType?: unknown
  base64?: unknown
  size?: unknown
}

const MAX_SHARED_TEXT_LENGTH = 64 * 1024
const MIME_TYPE = /^[\w.+-]+\/[\w.+-]+$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_SHARED_TEXT_LENGTH) : ''
}

function sharedFile(value: unknown): SharedDraftFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as RawSharedDraftFile
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  const mimeType = typeof raw.mimeType === 'string' ? raw.mimeType.trim().toLowerCase() : ''
  const base64 = typeof raw.base64 === 'string' ? raw.base64.trim() : ''
  const size = typeof raw.size === 'number' ? raw.size : NaN

  if (
    !name || name.length > 255 || name === '.' || name === '..' || /[\\/\u0000\r\n]/.test(name)
    || !MIME_TYPE.test(mimeType) || !BASE64.test(base64) || !Number.isFinite(size) || size < 0 || size > MAX_ATTACHMENT_BYTES
  ) return null

  // A base64 payload can claim a smaller size than it actually contains.
  const decodedLength = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  if (decodedLength < 0 || decodedLength > MAX_ATTACHMENT_BYTES) return null

  return { name, mimeType, base64, size }
}

/** Validates the narrow share payload accepted from the Android native bridge. */
export function normalizeSharedDraft(payload: unknown): SharedDraft | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raw = payload as { text?: unknown; subject?: unknown; files?: unknown }
  const files = Array.isArray(raw.files)
    ? raw.files.map(sharedFile).filter((file): file is SharedDraftFile => Boolean(file)).slice(0, MAX_ATTACHMENTS)
    : []
  const draft = { text: text(raw.text), subject: text(raw.subject), files }
  return draft.text || draft.subject || draft.files.length ? draft : null
}

/** Converts a validated native share into the same draft representation as the attachment picker. */
export function sharedDraftToComposer(draft: SharedDraft): { text: string; attachments: PendingAttachment[] } {
  return {
    text: [draft.subject, draft.text].filter(Boolean).join('\n\n'),
    attachments: draft.files.map(file => ({
      id: crypto.randomUUID(),
      kind: attachmentKind(file.name, file.mimeType),
      name: file.name,
      mimeType: file.mimeType,
      dataUrl: `data:${file.mimeType};base64,${file.base64}`,
      size: file.size,
    })),
  }
}

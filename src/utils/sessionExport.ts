export interface SessionExportInput<TSession = unknown, TMessage = unknown> {
  sessionId: string
  title: string | null | undefined
  session: TSession | null
  messages: TMessage[]
  exportedAt?: string
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Mirrors desktop's portable JSON session export contract. */
export function createSessionExport<TSession = unknown, TMessage = unknown>(input: SessionExportInput<TSession, TMessage>) {
  const providedTitle = input.title?.trim() || ''
  const title = providedTitle || 'Hermes Chat'
  const sessionId = input.sessionId || null
  const titlePart = sanitizeFilenamePart(providedTitle) || 'session'
  const idPart = sanitizeFilenamePart(input.sessionId).slice(0, 8).replace(/-+$/g, '') || 'chat'
  const payload = {
    exported_at: input.exportedAt || new Date().toISOString(),
    session_id: sessionId,
    title,
    session: input.session,
    message_count: input.messages.length,
    messages: input.messages,
  }

  return {
    fileName: `${titlePart}-${idPart}.json`,
    serialized: JSON.stringify(payload, null, 2),
  }
}

export type SessionExportDelivery = 'file' | 'text' | 'clipboard' | 'unavailable' | 'cancelled'

export interface SessionExportCapabilities {
  canShareFiles: boolean
  canShareText: boolean
  hasClipboard: boolean
}

/** Keep the mobile delivery preference deterministic and easy to test. */
export function chooseSessionExportDelivery(capabilities: SessionExportCapabilities): Exclude<SessionExportDelivery, 'cancelled'> {
  if (capabilities.canShareFiles) return 'file'
  if (capabilities.canShareText) return 'text'
  if (capabilities.hasClipboard) return 'clipboard'
  return 'unavailable'
}

export interface SessionExportFile {
  name: string
  type: string
}

export interface SessionExportShareTarget {
  share?: (data: { title: string; files?: SessionExportFile[]; text?: string }) => Promise<void>
  canShare?: (data: { files: SessionExportFile[] }) => boolean
  clipboard?: { writeText: (text: string) => Promise<void> }
}

export interface SessionExportArtifact {
  fileName: string
  serialized: string
}

function browserSessionExportTarget(): SessionExportShareTarget {
  return {
    share: typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      ? navigator.share.bind(navigator) as SessionExportShareTarget['share']
      : undefined,
    canShare: typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
      ? navigator.canShare.bind(navigator) as SessionExportShareTarget['canShare']
      : undefined,
    clipboard: typeof navigator !== 'undefined' ? navigator.clipboard : undefined,
  }
}

/** Deliver an export through native share first, with a complete JSON clipboard fallback. */
export async function deliverSessionExport(
  artifact: SessionExportArtifact,
  title: string,
  target: SessionExportShareTarget = browserSessionExportTarget(),
  makeFile: (serialized: string, fileName: string) => SessionExportFile = (serialized, fileName) => new File(
    [serialized],
    fileName,
    { type: 'application/json' },
  ),
): Promise<SessionExportDelivery> {
  const file = makeFile(artifact.serialized, artifact.fileName)
  const capabilities: SessionExportCapabilities = {
    canShareFiles: Boolean(target.share && target.canShare?.({ files: [file] })),
    canShareText: Boolean(target.share),
    hasClipboard: Boolean(target.clipboard),
  }
  const mode = chooseSessionExportDelivery(capabilities)

  try {
    if (mode === 'file' && target.share) {
      await target.share({ title, files: [file] })
      return 'file'
    }
    if (mode === 'text' && target.share) {
      await target.share({ title, text: artifact.serialized })
      return 'text'
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') return 'cancelled'
  }

  if (target.clipboard) {
    try {
      await target.clipboard.writeText(artifact.serialized)
      return 'clipboard'
    } catch {
      // Report the unavailable state to the caller rather than losing the export silently.
    }
  }

  return 'unavailable'
}

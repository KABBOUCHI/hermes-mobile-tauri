import type { SessionMessage } from './sessionMessages'

export interface GatewayImageRequest {
  key: string
  path: string
}

type GatewayImageMessage = Pick<SessionMessage, 'id' | 'role' | 'timestamp' | 'imageAttachments'>
type GatewayImageAttachment = Pick<NonNullable<GatewayImageMessage['imageAttachments']>[number], 'src' | 'gatewayPath'>

export function gatewayImageKey(
  sessionId: string,
  message: Pick<SessionMessage, 'id' | 'timestamp'>,
  attachment: GatewayImageAttachment,
  index: number,
): string {
  return `${sessionId}:${message.id || message.timestamp}:${attachment.gatewayPath || attachment.src || index}`
}

export function pendingGatewayImageRequests(
  messages: readonly GatewayImageMessage[],
  sessionId: string,
  resolvedKeys: ReadonlySet<string>,
  loadingKeys: ReadonlySet<string>,
): GatewayImageRequest[] {
  const requests: GatewayImageRequest[] = []
  const seenKeys = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'user') continue

    for (const [index, attachment] of (message.imageAttachments || []).entries()) {
      const path = attachment.gatewayPath?.trim()
      if (!path) continue

      const key = gatewayImageKey(sessionId, message, attachment, index)
      if (seenKeys.has(key) || resolvedKeys.has(key) || loadingKeys.has(key)) continue

      seenKeys.add(key)
      requests.push({ key, path })
    }
  }

  return requests
}

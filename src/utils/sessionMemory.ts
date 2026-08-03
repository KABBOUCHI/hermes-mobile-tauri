/**
 * Desktop remembers the last durable chat independently for each profile.
 * Mobile has one active profile, so the gateway URL is the equivalent scope.
 */
export const LAST_SESSION_STORAGE_PREFIX = 'last_session_id:'

export function gatewayIdentity(gatewayUrl: string): string {
  const trimmed = gatewayUrl.trim()
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase()
  }
}

export function lastSessionStorageKey(gatewayUrl: string): string {
  const identity = gatewayIdentity(gatewayUrl)
  return identity ? `${LAST_SESSION_STORAGE_PREFIX}${encodeURIComponent(identity)}` : ''
}

export function storedSessionId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const id = value.trim()
  return id || null
}

export interface GatewayStatus {
  version?: string
  gateway_mode?: string
}

export function gatewayStatusSummary(status: GatewayStatus): { version: string; mode: string } {
  return {
    version: status.version || '—',
    mode: status.gateway_mode || 'Connected',
  }
}

export function profileDisplayName(profile: { name?: string }): string {
  return profile.name || 'default'
}

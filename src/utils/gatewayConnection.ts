export type GatewayConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'
export type GatewayConnectionTone = 'info' | 'success' | 'error'

/** Keep post-boot connection recovery copy consistent across the shell. */
export function gatewayConnectionMessage(state: GatewayConnectionState): string {
  if (state === 'connecting') return 'Reconnecting to Hermes…'
  if (state === 'closed' || state === 'error') return 'Connection lost. Your draft stays on this device.'
  if (state === 'idle') return 'Gateway connection unavailable.'
  return ''
}

export function gatewayConnectionTone(state: GatewayConnectionState): GatewayConnectionTone {
  if (state === 'open') return 'success'
  if (state === 'connecting') return 'info'
  return 'error'
}

export function canRetryGatewayConnection(state: GatewayConnectionState): boolean {
  return state !== 'open' && state !== 'connecting'
}

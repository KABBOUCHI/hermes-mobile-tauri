import { describe, expect, it } from 'vitest'
import {
  gatewayConnectionMessage,
  gatewayConnectionTone,
  canRetryGatewayConnection,
  type GatewayConnectionState,
} from './gatewayConnection'

describe('gateway connection recovery copy', () => {
  it.each([
    ['connecting', 'Reconnecting to Hermes…', 'info', false],
    ['closed', 'Connection lost. Your draft stays on this device.', 'error', true],
    ['error', 'Connection lost. Your draft stays on this device.', 'error', true],
    ['idle', 'Gateway connection unavailable.', 'error', true],
    ['open', '', 'success', false],
  ] as const)('%s maps to stable recovery UI semantics', (state, message, tone, retryable) => {
    const connectionState = state as GatewayConnectionState

    expect(gatewayConnectionMessage(connectionState)).toBe(message)
    expect(gatewayConnectionTone(connectionState)).toBe(tone)
    expect(canRetryGatewayConnection(connectionState)).toBe(retryable)
  })
})

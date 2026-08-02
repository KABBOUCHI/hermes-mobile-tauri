const UNSCOPED_STREAM_EVENT_TYPES = new Set([
  'approval.request',
  'browser.progress',
  'clarify.request',
  'error',
  'message.complete',
  'message.delta',
  'message.interim',
  'message.start',
  'reasoning.available',
  'reasoning.delta',
  'secret.request',
  'status.update',
  'sudo.request',
  'thinking.delta',
  'tool.complete',
  'tool.generating',
  'tool.progress',
  'tool.start',
])

const UNSCOPED_STREAM_END_EVENT_TYPES = new Set(['error', 'message.complete'])

/**
 * Background subagent events need an explicit owner. Foreground stream events
 * are allowed to be unscoped because the gateway can emit them for the active
 * turn without repeating its runtime session id on every frame.
 */
export function gatewayEventRequiresSessionId(eventType: string | undefined): boolean {
  return eventType?.startsWith('subagent.') ?? false
}

export interface GatewayEventSessionRouteInput {
  activeSessionId: string | null
  eventType: string | undefined
  explicitSessionId: string
  unscopedStreamSessionId: string | null
}

export interface GatewayEventSessionRoute {
  drop: boolean
  nextUnscopedStreamSessionId: string | null
  sessionId: string | null
}

/**
 * Resolve the runtime session that owns a gateway event.
 *
 * Explicit session ids always win. For an unscoped stream, pin subsequent
 * deltas and terminal frames to the session that received message.start. This
 * prevents a chat switch during generation from attaching the answer to the
 * newly focused conversation, matching the desktop gateway-event contract.
 */
export function resolveGatewayEventSessionId({
  activeSessionId,
  eventType,
  explicitSessionId,
  unscopedStreamSessionId,
}: GatewayEventSessionRouteInput): GatewayEventSessionRoute {
  if (explicitSessionId) {
    const nextUnscopedStreamSessionId =
      eventType && UNSCOPED_STREAM_END_EVENT_TYPES.has(eventType) && explicitSessionId === unscopedStreamSessionId
        ? null
        : unscopedStreamSessionId

    return {
      drop: false,
      nextUnscopedStreamSessionId,
      sessionId: explicitSessionId,
    }
  }

  if (gatewayEventRequiresSessionId(eventType)) {
    return {
      drop: true,
      nextUnscopedStreamSessionId: unscopedStreamSessionId,
      sessionId: null,
    }
  }

  const streamEvent = eventType ? UNSCOPED_STREAM_EVENT_TYPES.has(eventType) : false
  const sessionId =
    eventType === 'message.start'
      ? activeSessionId
      : streamEvent
        ? unscopedStreamSessionId || activeSessionId
        : activeSessionId

  let nextUnscopedStreamSessionId = unscopedStreamSessionId
  if (eventType === 'message.start' && activeSessionId) {
    nextUnscopedStreamSessionId = activeSessionId
  } else if (eventType && UNSCOPED_STREAM_END_EVENT_TYPES.has(eventType)) {
    nextUnscopedStreamSessionId = null
  }

  return {
    drop: false,
    nextUnscopedStreamSessionId,
    sessionId,
  }
}

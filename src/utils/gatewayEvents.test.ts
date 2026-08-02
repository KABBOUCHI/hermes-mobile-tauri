import { describe, expect, it } from 'vitest'
import { gatewayEventRequiresSessionId, resolveGatewayEventSessionId } from './gatewayEvents'

describe('gateway event routing', () => {
  it('drops only unscoped subagent events', () => {
    expect(gatewayEventRequiresSessionId('subagent.progress')).toBe(true)
    expect(gatewayEventRequiresSessionId('message.delta')).toBe(false)
  })

  it('pins unscoped foreground frames to the session that started the stream', () => {
    const started = resolveGatewayEventSessionId({
      activeSessionId: 'runtime-a',
      eventType: 'message.start',
      explicitSessionId: '',
      unscopedStreamSessionId: null,
    })
    expect(started).toEqual({
      drop: false,
      nextUnscopedStreamSessionId: 'runtime-a',
      sessionId: 'runtime-a',
    })

    const delta = resolveGatewayEventSessionId({
      activeSessionId: 'runtime-b',
      eventType: 'message.delta',
      explicitSessionId: '',
      unscopedStreamSessionId: started.nextUnscopedStreamSessionId,
    })
    expect(delta).toEqual({
      drop: false,
      nextUnscopedStreamSessionId: 'runtime-a',
      sessionId: 'runtime-a',
    })

    const completed = resolveGatewayEventSessionId({
      activeSessionId: 'runtime-b',
      eventType: 'message.complete',
      explicitSessionId: '',
      unscopedStreamSessionId: delta.nextUnscopedStreamSessionId,
    })
    expect(completed).toEqual({
      drop: false,
      nextUnscopedStreamSessionId: null,
      sessionId: 'runtime-a',
    })
  })

  it('lets explicit events win and clears a matching pinned stream on completion', () => {
    expect(resolveGatewayEventSessionId({
      activeSessionId: 'runtime-b',
      eventType: 'message.complete',
      explicitSessionId: 'runtime-a',
      unscopedStreamSessionId: 'runtime-a',
    })).toEqual({
      drop: false,
      nextUnscopedStreamSessionId: null,
      sessionId: 'runtime-a',
    })
  })
})

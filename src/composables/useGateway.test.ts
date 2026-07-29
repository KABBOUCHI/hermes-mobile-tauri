import { describe, expect, it } from 'vitest'
import { MESSAGE_FETCH_TIMEOUT } from './useGateway'

describe('message history fetch policy', () => {
  it('allows long mobile transcript downloads more time than lightweight gateway calls', () => {
    expect(MESSAGE_FETCH_TIMEOUT).toBeGreaterThanOrEqual(60_000)
  })
})

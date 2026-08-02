import { describe, expect, it } from 'vitest'
import { isStreamStalled, STREAM_STALL_THRESHOLD_MS } from './streamStall'

describe('isStreamStalled', () => {
  it('matches desktop’s two-second quiet-stream threshold', () => {
    expect(STREAM_STALL_THRESHOLD_MS).toBe(2_000)
    expect(isStreamStalled(10_000, 10_000, 11_999)).toBe(false)
    expect(isStreamStalled(10_000, 10_000, 12_000)).toBe(true)
  })

  it('falls back to the turn start before the first visible delta', () => {
    expect(isStreamStalled(10_000, null, 11_999)).toBe(false)
    expect(isStreamStalled(10_000, null, 12_000)).toBe(true)
  })

  it('does not report a stall while no turn is active', () => {
    expect(isStreamStalled(null, null, 99_999)).toBe(false)
  })
})

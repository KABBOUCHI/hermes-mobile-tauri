import { describe, expect, it } from 'vitest'
import { isStreamStalled, nextStreamActivityDeadline, streamActivityState, STREAM_STALL_THRESHOLD_MS } from './streamStall'

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

  it('keeps a quiet response distinct from a silent transport', () => {
    expect(streamActivityState(10_000, 10_000, 11_999, 12_000)).toBe('quiet')
    expect(streamActivityState(10_000, 10_000, 10_000, 12_000)).toBe('stalled')
    expect(isStreamStalled(10_000, 10_000, 12_000, STREAM_STALL_THRESHOLD_MS, 11_999)).toBe(false)
  })

  it('schedules the next status transition without polling', () => {
    expect(nextStreamActivityDeadline(10_000, 10_000, 10_100, 10_500)).toBe(12_000)
    expect(nextStreamActivityDeadline(10_000, 10_000, 11_999, 12_000)).toBe(13_999)
    expect(nextStreamActivityDeadline(10_000, 10_000, 10_000, 12_000)).toBeNull()
  })
})

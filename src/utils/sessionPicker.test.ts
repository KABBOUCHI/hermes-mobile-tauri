import { describe, expect, it } from 'vitest'
import { sessionPickerRowsForDisplay } from './sessionPicker'

describe('sessionPickerRowsForDisplay', () => {
  it('keeps cached rows visible before the refresh returns', () => {
    const cached = [{ id: 'cached' }]

    expect(sessionPickerRowsForDisplay(null, cached)).toBe(cached)
  })

  it('honours an authoritative empty refresh instead of restoring stale rows', () => {
    const cached = [{ id: 'stale' }]

    expect(sessionPickerRowsForDisplay([], cached)).toEqual([])
  })

  it('uses refreshed rows once they are available', () => {
    const refreshed = [{ id: 'fresh' }]

    expect(sessionPickerRowsForDisplay(refreshed, [{ id: 'cached' }])).toBe(refreshed)
  })
})

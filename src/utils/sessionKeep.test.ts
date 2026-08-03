import { describe, expect, it } from 'vitest'
import { buildSessionListKeepIds } from './sessionKeep'

describe('buildSessionListKeepIds', () => {
  it('keeps pins, the active turn, running rows, and recently settled rows', () => {
    expect(buildSessionListKeepIds({
      pinnedIds: ['pinned', 'pinned'],
      activeSessionId: 'foreground',
      activeSessionRows: [
        { id: 'background-running', is_active: true },
        { id: 'quiet', is_active: false },
      ],
      recentlySettledIds: ['just-finished'],
    })).toEqual(new Set(['pinned', 'foreground', 'background-running', 'just-finished']))
  })

  it('deduplicates identities and ignores blank ids', () => {
    expect(buildSessionListKeepIds({
      pinnedIds: ['', 'foreground'],
      activeSessionId: 'foreground',
      activeSessionRows: [{ id: 'foreground', is_active: true }],
      recentlySettledIds: [' ', 'foreground'],
    })).toEqual(new Set(['foreground']))
  })

  it('does not preserve inactive rows merely because they were loaded', () => {
    expect(buildSessionListKeepIds({
      pinnedIds: [],
      activeSessionRows: [{ id: 'finished', is_active: false }],
      recentlySettledIds: [],
    })).toEqual(new Set())
  })
})

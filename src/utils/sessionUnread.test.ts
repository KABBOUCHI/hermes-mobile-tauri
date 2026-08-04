import { describe, expect, it } from 'vitest'
import { seedUnreadCounts, unreadSessionIds, sessionUnreadKey } from './sessionUnread'

describe('session unread identity', () => {
  it('uses the durable lineage root as the unread storage key', () => {
    expect(sessionUnreadKey({ id: 'tip', _lineage_root_id: 'root' })).toBe('root')
    expect(sessionUnreadKey({ id: 'plain' })).toBe('plain')
  })

  it('keeps legacy live-id read markers working after compression', () => {
    const sessions = [{ id: 'new-tip', _lineage_root_id: 'root', message_count: 5 }]

    expect(unreadSessionIds(sessions, { newTip: 0, 'old-tip': 5, root: 4 })).toEqual(new Set(['new-tip']))
    expect(unreadSessionIds([{ id: 'new-tip', _lineage_root_id: 'root', message_count: 5 }], { 'new-tip': 5 })).toEqual(new Set())
  })

  it('returns live ids for the visible list while reading durable markers', () => {
    const sessions = [
      { id: 'tip', _lineage_root_id: 'root', message_count: 3 },
      { id: 'other', message_count: 4 },
    ]

    expect(unreadSessionIds(sessions, { root: 1, other: 4 })).toEqual(new Set(['tip']))
  })

  it('seeds first-seen sessions so later count changes become unread', () => {
    const sessions = [
      { id: 'desktop-1', message_count: 4 },
      { id: 'tip', _lineage_root_id: 'root', message_count: 7 },
    ]

    const baseline = seedUnreadCounts(sessions, { existing: 2 })
    expect(baseline).toEqual({
      existing: 2,
      'desktop-1': 4,
      root: 7,
    })
    expect(seedUnreadCounts(sessions, { tip: 6 })).toEqual({
      tip: 6,
      'desktop-1': 4,
    })
    expect(unreadSessionIds([
      { id: 'desktop-1', message_count: 5 },
      { id: 'tip', _lineage_root_id: 'root', message_count: 7 },
    ], baseline)).toEqual(new Set(['desktop-1']))
  })
})

import { describe, expect, it } from 'vitest'
import { excludePinnedSessions, flattenSessionsWithBranches, mergeSessionPage, mergeSessionsById, moveSessionIdInOrder, optimisticSessionForSend, orderSessionsByIds, sessionIsPinned, sessionMatchesStoredId, sessionPinId } from './sessionList'

describe('mergeSessionsById', () => {
  it('deduplicates overlapping pages while retaining the freshest session data', () => {
    const existing = [
      { id: 'newest', preview: 'old preview', message_count: 2 },
      { id: 'middle', preview: 'unchanged', message_count: 1 },
    ]
    const incoming = [
      { id: 'newest', preview: 'fresh preview', message_count: 3 },
      { id: 'older', preview: 'new row', message_count: 1 },
    ]

    expect(mergeSessionsById(existing, incoming)).toEqual([
      { id: 'newest', preview: 'fresh preview', message_count: 3 },
      { id: 'middle', preview: 'unchanged', message_count: 1 },
      { id: 'older', preview: 'new row', message_count: 1 },
    ])
  })

  it('uses the last copy of a duplicated row returned by a page', () => {
    const incoming = [
      { id: 'same', preview: 'stale', message_count: 1 },
      { id: 'same', preview: 'fresh', message_count: 2 },
    ]

    expect(mergeSessionsById([], incoming)).toEqual([
      { id: 'same', preview: 'fresh', message_count: 2 },
    ])
  })

  it('repairs duplicates already present in the visible list', () => {
    const existing = [
      { id: 'same', preview: 'older copy', message_count: 1 },
      { id: 'other', preview: 'keep', message_count: 1 },
      { id: 'same', preview: 'newer copy', message_count: 2 },
    ]

    expect(mergeSessionsById(existing, [])).toEqual([
      { id: 'same', preview: 'newer copy', message_count: 2 },
      { id: 'other', preview: 'keep', message_count: 1 },
    ])
  })
})

describe('optimisticSessionForSend', () => {
  it('seeds a desktop session row with the first prompt until refresh reconciles it', () => {
    expect(optimisticSessionForSend('new-session', '  Inspect the gateway  ', 123)).toEqual({
      id: 'new-session',
      title: null,
      preview: 'Inspect the gateway',
      model: '',
      message_count: 1,
      last_active: 123,
      started_at: 123,
      is_active: true,
      source: 'desktop',
    })
  })
})

describe('mergeSessionPage', () => {
  it('keeps a pinned row that falls outside the refreshed recency page', () => {
    const previous = [
      { id: 'pinned', title: 'Important chat', preview: 'old', message_count: 4 },
      { id: 'recent', title: 'Recent chat', preview: 'old', message_count: 2 },
    ]
    const incoming = [
      { id: 'recent', title: 'Recent chat', preview: 'fresh', message_count: 3 },
      { id: 'new', title: null, preview: 'New chat', message_count: 1 },
    ]

    expect(mergeSessionPage(previous, incoming, ['pinned'])).toEqual([
      previous[0],
      incoming[0],
      incoming[1],
    ])
  })

  it('matches pinned lineage roots when compression rotates the live id', () => {
    type TestSession = { id: string; _lineage_root_id: string; title: string | null; preview: string }
    const previous: TestSession[] = [{ id: 'old-tip', _lineage_root_id: 'root', title: 'Pinned', preview: 'old' }]
    const incoming: TestSession[] = [{ id: 'new-tip', _lineage_root_id: 'root', title: null, preview: 'fresh' }]

    expect(mergeSessionPage(previous, incoming, ['root'])).toEqual(incoming)
  })
})

describe('orderSessionsByIds', () => {
  it('uses persisted pin order, ignores stale ids, and does not duplicate rows', () => {
    const sessions = [
      { id: 'recent', preview: 'Most recently active' },
      { id: 'older', preview: 'Older pinned session' },
      { id: 'other', preview: 'Not pinned' },
    ]

    expect(orderSessionsByIds(sessions, ['older', 'missing', 'recent', 'older'])).toEqual([
      { id: 'older', preview: 'Older pinned session' },
      { id: 'recent', preview: 'Most recently active' },
    ])
  })
})

describe('moveSessionIdInOrder', () => {
  it('moves a pinned session one position while preserving every id', () => {
    expect(moveSessionIdInOrder(['first', 'second', 'third'], ['second'], 'down')).toEqual([
      'first',
      'third',
      'second',
    ])
    expect(moveSessionIdInOrder(['first', 'second', 'third'], ['second'], 'up')).toEqual([
      'second',
      'first',
      'third',
    ])
  })

  it('supports lineage-root targets and leaves boundary or unknown moves unchanged', () => {
    expect(moveSessionIdInOrder(['root', 'other'], ['live-tip', 'root'], 'up')).toEqual(['root', 'other'])
    expect(moveSessionIdInOrder(['root', 'other'], ['live-tip', 'root'], 'down')).toEqual(['other', 'root'])
    expect(moveSessionIdInOrder(['root', 'live-tip', 'other'], ['live-tip', 'root'], 'down')).toEqual(['other', 'root', 'live-tip'])
    expect(moveSessionIdInOrder(['other', 'root', 'live-tip'], ['live-tip', 'root'], 'up')).toEqual(['root', 'live-tip', 'other'])
    expect(moveSessionIdInOrder(['root', 'other'], ['missing'], 'down')).toEqual(['root', 'other'])
  })
})

describe('session pin identity', () => {
  it('uses the durable lineage root when compression rotates the live id', () => {
    expect(sessionPinId({ id: 'tip', _lineage_root_id: 'root' })).toBe('root')
    expect(sessionPinId({ id: 'plain' })).toBe('plain')
  })

  it('resolves persisted lineage-root pins to the live session row', () => {
    const liveSession = { id: 'tip', _lineage_root_id: 'root', preview: 'Compressed conversation' }
    expect(orderSessionsByIds([liveSession], ['root'])).toEqual([liveSession])
    expect(sessionIsPinned(liveSession, ['root'])).toBe(true)
  })

  it('excludes a lineage-root-pinned live row from ordinary recents', () => {
    const liveSession = { id: 'tip', _lineage_root_id: 'root' }
    const recentSession = { id: 'recent' }

    expect(excludePinnedSessions([liveSession, recentSession], ['root'])).toEqual([recentSession])
  })

  it('keeps legacy live-id pins recognised while they are migrated', () => {
    const liveSession = { id: 'tip', _lineage_root_id: 'root' }
    expect(sessionIsPinned(liveSession, ['tip'])).toBe(true)
  })

  it('matches active state against either the live id or compressed lineage root', () => {
    const liveSession = { id: 'tip', _lineage_root_id: 'root' }
    expect(sessionMatchesStoredId(liveSession, 'tip')).toBe(true)
    expect(sessionMatchesStoredId(liveSession, 'root')).toBe(true)
    expect(sessionMatchesStoredId(liveSession, 'other')).toBe(false)
    expect(sessionMatchesStoredId(liveSession, null)).toBe(false)
  })
})

describe('flattenSessionsWithBranches', () => {
  it('keeps branches beside their parent and orders sibling branches by recency', () => {
    const sessions = [
      { id: 'other', last_active: 5 },
      { id: 'parent', last_active: 10 },
      { id: 'older-branch', last_active: 11, parent_session_id: 'parent' },
      { id: 'newer-branch', last_active: 15, parent_session_id: 'parent' },
    ]

    expect(flattenSessionsWithBranches(sessions)).toEqual([
      { session: { id: 'parent', last_active: 10 } },
      { branchStem: '├─', session: { id: 'newer-branch', last_active: 15, parent_session_id: 'parent' } },
      { branchStem: '└─', session: { id: 'older-branch', last_active: 11, parent_session_id: 'parent' } },
      { session: { id: 'other', last_active: 5 } },
    ])
  })

  it('uses a compressed lineage root to attach a branch to the visible session', () => {
    const visibleTip = { id: 'tip', _lineage_root_id: 'root', last_active: 30 }
    const branch = { id: 'branch', parent_session_id: 'root', last_active: 10 }

    expect(flattenSessionsWithBranches([visibleTip, branch])).toEqual([
      { session: visibleTip },
      { branchStem: '└─', session: branch },
    ])
  })

  it('retains sessions with missing parents instead of dropping them', () => {
    const orphan = { id: 'orphan', parent_session_id: 'missing', last_active: 10 }
    expect(flattenSessionsWithBranches([orphan, { id: 'other', last_active: 5 }])).toEqual([
      { session: orphan },
      { session: { id: 'other', last_active: 5 } },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { flattenSessionsWithBranches, mergeSessionsById, orderSessionsByIds } from './sessionList'

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

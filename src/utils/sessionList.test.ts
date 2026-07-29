import { describe, expect, it } from 'vitest'
import { mergeSessionsById } from './sessionList'

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

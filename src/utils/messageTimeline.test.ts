import { describe, expect, it } from 'vitest'
import { activeMessageTimelineIndex, deriveMessageTimeline, timelinePreview } from './messageTimeline'

describe('message timeline', () => {
  it('derives compact user-turn previews and ignores injected process notices', () => {
    const entries = deriveMessageTimeline([
      { id: 'system-1', role: 'system', content: 'model changed' },
      { id: 'user-1', role: 'user', content: '  Inspect the gateway  ', timestamp: 1 },
      { id: 'notice', role: 'user', content: '[IMPORTANT: Background process finished\noutput]' },
      { id: 'assistant-1', role: 'assistant', content: 'Done' },
      { id: 'user-2', role: 'user', content: '', imageAttachments: [{}], timestamp: 2 },
    ])

    expect(entries).toEqual([
      { id: 'user-1', messageIndex: 1, preview: 'Inspect the gateway', timestamp: 1 },
      { id: 'user-2', messageIndex: 4, preview: '1 image attachment', timestamp: 2 },
    ])
  })

  it('collapses whitespace and truncates long previews', () => {
    expect(timelinePreview('  one\n two\t three  ', 30)).toBe('one two three')
    expect(timelinePreview('abcdefghijklmnopqrstuvwxyz', 10)).toBe('abcdefghi…')
  })

  it('tracks the last rendered turn above the viewport', () => {
    expect(activeMessageTimelineIndex([null, 240, 30, -90])).toBe(3)
    expect(activeMessageTimelineIndex([null, null])).toBe(0)
    expect(activeMessageTimelineIndex([180, 260])).toBe(0)
  })
})

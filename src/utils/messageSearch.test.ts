import { describe, expect, it } from 'vitest'
import { messageMatchesSearch, visibleMessageSearchText } from './messageSearch'

describe('visibleMessageSearchText', () => {
  it('includes reasoning and grouped tool details rendered by the transcript', () => {
    const message = {
      role: 'tool' as const,
      content: '',
      timestamp: 1,
      reasoning: 'Inspecting the gateway contract',
      toolCalls: [{ id: 'call-1', name: 'read_file' }],
      toolResults: [{ id: 'tool-1', name: 'read_file', content: 'session.resume requires a stored session ID', timestamp: 2 }],
      activityThoughts: [{ id: 'thought-1', content: 'Checking the current transport flow', durationSeconds: 3 }],
    }

    expect(visibleMessageSearchText(message)).toContain('Inspecting the gateway contract')
    expect(messageMatchesSearch(message, 'stored session')).toBe(true)
    expect(messageMatchesSearch(message, 'transport flow')).toBe(true)
  })

  it('does not report a match for an empty query', () => {
    expect(messageMatchesSearch({ content: 'A visible message' }, '   ')).toBe(false)
  })
})

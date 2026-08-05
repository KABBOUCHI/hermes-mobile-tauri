import { describe, expect, it } from 'vitest'
import { filterSessionsBySource, handoffOriginSource } from './sessionSource'

const sessions = [
  { id: 'desktop', source: 'desktop' },
  { id: 'discord', source: 'discord' },
  { id: 'unknown', source: '' },
]

describe('filterSessionsBySource', () => {
  it('defaults to desktop sessions and supports an all-sources view', () => {
    expect(filterSessionsBySource(sessions, 'desktop').map(session => session.id)).toEqual(['desktop'])
    expect(filterSessionsBySource(sessions, 'all').map(session => session.id)).toEqual(['desktop', 'discord', 'unknown'])
  })
})

describe('handoffOriginSource', () => {
  it('preserves a completed messaging origin when the live source is local', () => {
    expect(handoffOriginSource('completed', ' Telegram ')).toBe('telegram')
  })

  it('does not label incomplete or local handoffs as external origins', () => {
    expect(handoffOriginSource('pending', 'telegram')).toBeNull()
    expect(handoffOriginSource('completed', 'desktop')).toBeNull()
    expect(handoffOriginSource('completed', '')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { filterSessionsBySource } from './sessionSource'

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

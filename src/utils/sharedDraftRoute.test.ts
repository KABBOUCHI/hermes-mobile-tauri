import { describe, expect, it } from 'vitest'
import { sharedDraftNavigation } from './sharedDraftRoute'

describe('sharedDraftNavigation', () => {
  it('uses a unique query token to re-enter a fresh chat route', () => {
    expect(sharedDraftNavigation('intent-42')).toEqual({
      name: 'chat',
      query: { shared: 'intent-42' },
    })
  })
})

import { describe, expect, it } from 'vitest'
import { sessionListTitle, sessionPreview } from './sessionTitle'

describe('session list title and preview', () => {
  it('keeps an untitled session label separate from its preview', () => {
    const session = { title: null, preview: 'Inspect the gateway' }

    expect(sessionListTitle(session)).toBe('Untitled session')
    expect(sessionPreview(session)).toBe('Inspect the gateway')
  })

  it('uses an explicit title and trims empty preview values', () => {
    expect(sessionListTitle({ title: '  Gateway work  ', preview: 'Last message' })).toBe('Gateway work')
    expect(sessionPreview({ title: 'Named', preview: '   ' })).toBe('No messages')
  })
})

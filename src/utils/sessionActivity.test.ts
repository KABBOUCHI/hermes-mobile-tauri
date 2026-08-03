import { describe, expect, it } from 'vitest'
import { sessionActivityState } from './sessionActivity'

describe('sessionActivityState', () => {
  it('prioritises a clarification prompt above every other session state', () => {
    expect(sessionActivityState({ isActive: true, isCurrentTurn: true, isUnread: true, needsInput: true })).toBe('needs-input')
  })

  it('prioritises the local turn over background and unread markers', () => {
    expect(sessionActivityState({ isActive: true, isCurrentTurn: true, isUnread: true })).toBe('working')
  })

  it('distinguishes a quiet local turn from actively streaming work', () => {
    expect(sessionActivityState({ isActive: true, isCurrentTurn: true, isStalled: true, isUnread: true })).toBe('stalled')
  })

  it('keeps a clarification prompt above a stalled local turn', () => {
    expect(sessionActivityState({ isActive: true, isCurrentTurn: true, isStalled: true, isUnread: true, needsInput: true })).toBe('needs-input')
  })

  it('shows a background-running session before its unread state', () => {
    expect(sessionActivityState({ isActive: true, isCurrentTurn: false, isUnread: true })).toBe('background')
  })

  it('shows finished unread sessions when they are no longer active', () => {
    expect(sessionActivityState({ isActive: false, isCurrentTurn: false, isUnread: true })).toBe('unread')
  })

  it('keeps ordinary sessions visually quiet', () => {
    expect(sessionActivityState({ isActive: false, isCurrentTurn: false, isUnread: false })).toBe('idle')
  })
})

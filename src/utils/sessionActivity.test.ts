import { describe, expect, it } from 'vitest'
import { sessionActivityState } from './sessionActivity'

describe('sessionActivityState', () => {
  it('prioritises the local turn over background and unread markers', () => {
    expect(sessionActivityState({ isActive: true, isCurrentTurn: true, isUnread: true })).toBe('working')
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

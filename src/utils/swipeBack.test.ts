import { describe, expect, it } from 'vitest'
import { isBackSwipe } from './swipeBack'

describe('isBackSwipe', () => {
  it('accepts a deliberate horizontal gesture from the left edge', () => {
    expect(isBackSwipe({ startX: 12, startY: 240, currentX: 96, currentY: 252 })).toBe(true)
  })

  it('rejects a swipe that starts away from the edge', () => {
    expect(isBackSwipe({ startX: 40, startY: 240, currentX: 140, currentY: 240 })).toBe(false)
  })

  it('rejects short and predominantly vertical movements', () => {
    expect(isBackSwipe({ startX: 12, startY: 240, currentX: 70, currentY: 240 })).toBe(false)
    expect(isBackSwipe({ startX: 12, startY: 240, currentX: 96, currentY: 330 })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { isNearChatBottom, jumpToBottomOffset } from './chatScroll'

describe('isNearChatBottom', () => {
  it('keeps following when the viewport is at or near the newest message', () => {
    expect(isNearChatBottom({ scrollHeight: 1000, scrollTop: 750, clientHeight: 200 })).toBe(true)
    expect(isNearChatBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 200 })).toBe(true)
  })

  it('stops following when the reader scrolls back through the conversation', () => {
    expect(isNearChatBottom({ scrollHeight: 1000, scrollTop: 699, clientHeight: 200 })).toBe(false)
  })
})

describe('jumpToBottomOffset', () => {
  it('clears the measured composer with a consistent gap', () => {
    expect(jumpToBottomOffset(56)).toBe(66)
    expect(jumpToBottomOffset(136)).toBe(146)
  })

  it('uses the default composer height before measurement is available', () => {
    expect(jumpToBottomOffset(0)).toBe(66)
  })
})

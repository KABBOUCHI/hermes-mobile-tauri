import { describe, expect, it } from 'vitest'
import { isNearChatBottom } from './chatScroll'

describe('isNearChatBottom', () => {
  it('keeps following when the viewport is at or near the newest message', () => {
    expect(isNearChatBottom({ scrollHeight: 1000, scrollTop: 750, clientHeight: 200 })).toBe(true)
    expect(isNearChatBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 200 })).toBe(true)
  })

  it('stops following when the reader scrolls back through the conversation', () => {
    expect(isNearChatBottom({ scrollHeight: 1000, scrollTop: 699, clientHeight: 200 })).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { formatElapsedSeconds } from './elapsedTime'

describe('formatElapsedSeconds', () => {
  it('uses compact seconds for sub-minute activity', () => {
    expect(formatElapsedSeconds(0)).toBe('0s')
    expect(formatElapsedSeconds(7.9)).toBe('7s')
    expect(formatElapsedSeconds(-2)).toBe('0s')
  })

  it('uses a stable minute:second duration for longer activity', () => {
    expect(formatElapsedSeconds(60)).toBe('1:00')
    expect(formatElapsedSeconds(125)).toBe('2:05')
  })
})

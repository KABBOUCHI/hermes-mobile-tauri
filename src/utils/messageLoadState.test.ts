import { describe, expect, it } from 'vitest'
import { messageLoadErrorState } from './messageLoadState'

describe('messageLoadErrorState', () => {
  it('keeps an initial transcript failure as an empty-state error', () => {
    expect(messageLoadErrorState('', false)).toEqual({ kind: 'none', message: '' })
    expect(messageLoadErrorState('HTTP 503', false)).toEqual({ kind: 'empty', message: 'HTTP 503' })
  })

  it('keeps cached transcript content readable while exposing a failed refresh inline', () => {
    expect(messageLoadErrorState('Network unavailable', true)).toEqual({
      kind: 'inline',
      message: 'Network unavailable',
    })
  })
})

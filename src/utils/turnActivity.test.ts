import { describe, expect, it } from 'vitest'
import { settledTurnActivity } from './turnActivity'

describe('settledTurnActivity', () => {
  it('clears both clocks after a terminal turn failure', () => {
    expect(settledTurnActivity()).toEqual({
      turnStartedAt: null,
      lastStreamActivityAt: null,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { normalizeClarifyRequest } from './clarify'

describe('normalizeClarifyRequest', () => {
  it('keeps a valid question and usable choices', () => {
    expect(normalizeClarifyRequest({
      choices: [' production ', '', 'two\nlines', 'staging'],
      question: '  Which environment?  ',
      request_id: ' req-1 ',
    }, 'runtime-1')).toEqual({
      requestId: 'req-1',
      question: 'Which environment?',
      choices: [' production ', 'staging'],
      sessionId: 'runtime-1',
    })
  })

  it('falls back to free text when choices are absent or unusable', () => {
    expect(normalizeClarifyRequest({
      choices: ['', 'line\nbreak'],
      question: 'Explain the change',
      request_id: 'req-2',
    }, 'runtime-2')?.choices).toBeNull()
  })

  it('rejects incomplete or unscoped requests', () => {
    expect(normalizeClarifyRequest({ question: 'Missing id' }, 'runtime-3')).toBeNull()
    expect(normalizeClarifyRequest({ question: 'No session', request_id: 'req-4' }, null)).toBeNull()
  })
})

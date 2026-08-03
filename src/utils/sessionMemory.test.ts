import { describe, expect, it } from 'vitest'
import { gatewayIdentity, lastSessionStorageKey, storedSessionId } from './sessionMemory'

describe('gatewayIdentity', () => {
  it('normalizes gateway casing and trailing slashes', () => {
    expect(gatewayIdentity(' HTTPS://Example.COM:443/hermes/// ')).toBe('https://example.com/hermes')
  })

  it('keeps different gateway paths isolated', () => {
    expect(gatewayIdentity('https://example.com/a')).not.toBe(gatewayIdentity('https://example.com/b'))
  })

  it('falls back safely for an incomplete gateway value', () => {
    expect(gatewayIdentity(' gateway.local/// ')).toBe('gateway.local')
    expect(gatewayIdentity('')).toBe('')
  })
})

describe('lastSessionStorageKey', () => {
  it('scopes storage keys to the normalized gateway', () => {
    expect(lastSessionStorageKey('https://Example.com/')).toBe(
      'last_session_id:https%3A%2F%2Fexample.com',
    )
    expect(lastSessionStorageKey('')).toBe('')
  })
})

describe('storedSessionId', () => {
  it('rejects empty and non-string values', () => {
    expect(storedSessionId('  session-1  ')).toBe('session-1')
    expect(storedSessionId('   ')).toBeNull()
    expect(storedSessionId(undefined)).toBeNull()
  })
})

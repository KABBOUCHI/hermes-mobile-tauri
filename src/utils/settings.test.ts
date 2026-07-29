import { describe, expect, it } from 'vitest'
import { gatewayStatusSummary, profileDisplayName } from './settings'

describe('gatewayStatusSummary', () => {
  it('uses known gateway status fields and safe fallbacks', () => {
    expect(gatewayStatusSummary({ version: '0.64.0', gateway_mode: 'multiple' })).toEqual({ version: '0.64.0', mode: 'multiple' })
    expect(gatewayStatusSummary({})).toEqual({ version: '—', mode: 'Connected' })
  })
})

describe('profileDisplayName', () => {
  it('falls back to the default profile name', () => {
    expect(profileDisplayName({ name: 'work' })).toBe('work')
    expect(profileDisplayName({})).toBe('default')
  })
})

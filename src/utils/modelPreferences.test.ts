import { describe, expect, it } from 'vitest'
import {
  modelPreferenceKey,
  normalizeModelPreferences,
  recordRecentModel,
  toggleFavouriteModel,
} from './modelPreferences'

describe('model preferences', () => {
  it('uses a provider-qualified key so duplicate model names never collide', () => {
    expect(modelPreferenceKey(' openai ', ' gpt-5 ')).toBe('openai:gpt-5')
    expect(modelPreferenceKey('anthropic', 'gpt-5')).toBe('anthropic:gpt-5')
  })

  it('normalizes legacy and duplicate entries without keeping malformed models', () => {
    expect(normalizeModelPreferences([
      { provider: 'openai', model: 'gpt-5' },
      { provider: ' openai ', model: ' gpt-5 ' },
      { provider: '', model: 'missing-provider' },
      { provider: 'anthropic', model: '' },
    ])).toEqual([{ provider: 'openai', model: 'gpt-5' }])
  })

  it('toggles favourites without changing the stored preference order', () => {
    const existing = [
      { provider: 'openai', model: 'gpt-5' },
      { provider: 'anthropic', model: 'claude-sonnet' },
    ]

    expect(toggleFavouriteModel(existing, { provider: 'openai', model: 'gpt-5' })).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet' },
    ])
    expect(toggleFavouriteModel(existing, { provider: 'google', model: 'gemini' })).toEqual([
      ...existing,
      { provider: 'google', model: 'gemini' },
    ])
  })

  it('moves the selected model to the front of a bounded recent list', () => {
    const recents = [
      { provider: 'openai', model: 'gpt-5' },
      { provider: 'anthropic', model: 'claude-sonnet' },
      { provider: 'google', model: 'gemini' },
    ]

    expect(recordRecentModel(recents, { provider: 'anthropic', model: 'claude-sonnet' }, 2)).toEqual([
      { provider: 'anthropic', model: 'claude-sonnet' },
      { provider: 'openai', model: 'gpt-5' },
    ])
  })
})

import { describe, expect, it } from 'vitest'
import { compactTokenCount, contextUsagePercent, contextUsageSummary, normalizeContextUsage } from './contextUsage'

describe('normalizeContextUsage', () => {
  it('normalises the desktop breakdown response and derives a missing percentage', () => {
    const usage = normalizeContextUsage({
      context_max: 272_000,
      context_used: 13_600,
      categories: [
        { id: 'system', label: 'System', color: '#5e6ad2', tokens: 4_000 },
        { id: 'invalid', tokens: 'not-a-number' },
      ],
      estimated_total: 14_000,
      model: 'provider/model',
    })

    expect(usage).toEqual({
      categories: [{ id: 'system', label: 'System', color: '#5e6ad2', tokens: 4_000 }],
      contextMax: 272_000,
      contextPercent: 5,
      contextUsed: 13_600,
      estimatedTotal: 14_000,
      model: 'provider/model',
    })
  })

  it('clamps malformed percentages and rejects non-object responses', () => {
    expect(normalizeContextUsage({ context_percent: 140, context_used: 1 })).toMatchObject({ contextPercent: 100 })
    expect(normalizeContextUsage({ context_percent: -10, context_used: 1 })).toMatchObject({ contextPercent: 0 })
    expect(normalizeContextUsage(null)).toBeNull()
  })
})

describe('context usage presentation', () => {
  it('formats compact token counts and context summaries', () => {
    expect(compactTokenCount(999)).toBe('999')
    expect(compactTokenCount(1_234)).toBe('1.2k')
    expect(compactTokenCount(1_200_000)).toBe('1.2M')
    expect(compactTokenCount(2_000_000_000)).toBe('2B')

    const usage = normalizeContextUsage({ context_used: 13_600, context_max: 272_000, context_percent: 5 })!
    expect(contextUsageSummary(usage)).toBe('13.6k/272k')
    expect(contextUsagePercent(usage)).toBe(5)
  })
})

export interface ContextUsageCategory {
  id: string
  label: string
  color: string
  tokens: number
}

export interface ContextUsage {
  categories: ContextUsageCategory[]
  contextMax: number
  contextPercent: number
  contextUsed: number
  estimatedTotal: number
  model: string
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

function boundedPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/** Normalise the desktop `session.context_breakdown` response for mobile. */
export function normalizeContextUsage(raw: unknown): ContextUsage | null {
  if (!raw || typeof raw !== 'object') return null

  const record = raw as Record<string, unknown>
  const contextMax = nonNegativeNumber(record.context_max)
  const contextUsed = nonNegativeNumber(record.context_used)
  const hasReportedPercent = typeof record.context_percent === 'number' && Number.isFinite(record.context_percent)
  const reportedPercent = hasReportedPercent ? nonNegativeNumber(record.context_percent) : 0
  const contextPercent = contextMax > 0 && !hasReportedPercent
    ? boundedPercent((contextUsed / contextMax) * 100)
    : boundedPercent(reportedPercent)

  const categories = Array.isArray(record.categories)
    ? record.categories.flatMap(item => {
      if (!item || typeof item !== 'object') return []
      const category = item as Record<string, unknown>
      const id = typeof category.id === 'string' ? category.id.trim() : ''
      const label = typeof category.label === 'string' ? category.label.trim() : ''
      if (!id || !label) return []
      return [{
        id,
        label,
        color: typeof category.color === 'string' && category.color.trim() ? category.color : '#5e6ad2',
        tokens: nonNegativeNumber(category.tokens),
      }]
    })
    : []

  return {
    categories,
    contextMax,
    contextPercent,
    contextUsed,
    estimatedTotal: nonNegativeNumber(record.estimated_total),
    model: typeof record.model === 'string' ? record.model : '',
  }
}

/** Match Desktop's compact status-bar number style without locale drift. */
export function compactTokenCount(value: number): string {
  const amount = Math.max(0, Math.round(value))
  if (amount < 1_000) return String(amount)
  if (amount < 1_000_000) return `${trimUnit(amount / 1_000)}k`
  if (amount < 1_000_000_000) return `${trimUnit(amount / 1_000_000)}M`
  return `${trimUnit(amount / 1_000_000_000)}B`
}

function trimUnit(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
}

export function contextUsageSummary(usage: ContextUsage): string {
  if (usage.contextMax > 0) {
    return `${compactTokenCount(usage.contextUsed)}/${compactTokenCount(usage.contextMax)}`
  }
  return usage.contextUsed > 0 ? `${compactTokenCount(usage.contextUsed)} tok` : ''
}

export function contextUsagePercent(usage: ContextUsage): number {
  return boundedPercent(usage.contextPercent)
}

export interface ModelPreference {
  provider: string
  model: string
}

function normalizeModelPreference(value: unknown): ModelPreference | null {
  if (!value || typeof value !== 'object') return null
  const { provider, model } = value as Record<string, unknown>
  if (typeof provider !== 'string' || typeof model !== 'string') return null

  const normalized = { provider: provider.trim(), model: model.trim() }
  return normalized.provider && normalized.model ? normalized : null
}

/** Stable local identity for a gateway model selection. */
export function modelPreferenceKey(provider: string, model: string): string {
  return `${provider.trim()}:${model.trim()}`
}

/** Remove malformed/duplicate values while retaining the user's saved order. */
export function normalizeModelPreferences(values: unknown): ModelPreference[] {
  if (!Array.isArray(values)) return []

  const seen = new Set<string>()
  return values.flatMap(value => {
    const preference = normalizeModelPreference(value)
    if (!preference) return []

    const key = modelPreferenceKey(preference.provider, preference.model)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [preference]
  })
}

/** Toggle a favourite while preserving the list order chosen by the user. */
export function toggleFavouriteModel(
  favourites: readonly ModelPreference[],
  candidate: ModelPreference,
): ModelPreference[] {
  const normalizedCandidate = normalizeModelPreference(candidate)
  const normalizedFavourites = normalizeModelPreferences(favourites)
  if (!normalizedCandidate) return normalizedFavourites

  const key = modelPreferenceKey(normalizedCandidate.provider, normalizedCandidate.model)
  if (normalizedFavourites.some(item => modelPreferenceKey(item.provider, item.model) === key)) {
    return normalizedFavourites.filter(item => modelPreferenceKey(item.provider, item.model) !== key)
  }

  return [...normalizedFavourites, normalizedCandidate]
}

/** Put a successful selection first and retain a small, de-duplicated history. */
export function recordRecentModel(
  recents: readonly ModelPreference[],
  candidate: ModelPreference,
  limit = 5,
): ModelPreference[] {
  const normalizedCandidate = normalizeModelPreference(candidate)
  if (!normalizedCandidate || !Number.isFinite(limit) || limit < 1) return []

  const candidateKey = modelPreferenceKey(normalizedCandidate.provider, normalizedCandidate.model)
  return [
    normalizedCandidate,
    ...normalizeModelPreferences(recents).filter(item => modelPreferenceKey(item.provider, item.model) !== candidateKey),
  ].slice(0, Math.floor(limit))
}

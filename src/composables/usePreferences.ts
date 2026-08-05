import { ref } from 'vue'
import { load } from '@tauri-apps/plugin-store'
import {
  normalizeModelPreferences,
  recordRecentModel,
  toggleFavouriteModel,
  type ModelPreference,
} from '../utils/modelPreferences'

export type Appearance = 'system' | 'dark' | 'light'

const appearance = ref<Appearance>('system')
const modelFavourites = ref<ModelPreference[]>([])
const modelRecents = ref<ModelPreference[]>([])
let initialized = false

function applyAppearance(value: Appearance) {
  document.documentElement.dataset.theme = value === 'system' ? '' : value
}

export function usePreferences() {
  async function init() {
    if (initialized) return
    initialized = true
    try {
      const store = await load('settings.json', { autoSave: true })
      const saved = await store.get<Appearance>('appearance')
      if (saved === 'system' || saved === 'dark' || saved === 'light') appearance.value = saved
      modelFavourites.value = normalizeModelPreferences(await store.get<unknown>('model_favourites'))
      modelRecents.value = normalizeModelPreferences(await store.get<unknown>('model_recents'))
    } catch (err) {
      console.warn('[usePreferences] init:', err)
    }
    applyAppearance(appearance.value)
  }

  async function setAppearance(value: Appearance) {
    appearance.value = value
    applyAppearance(value)
    try {
      const store = await load('settings.json', { autoSave: true })
      await store.set('appearance', value)
    } catch (err) {
      console.warn('[usePreferences] setAppearance:', err)
    }
  }

  async function saveModelPreferences() {
    try {
      const store = await load('settings.json', { autoSave: true })
      await Promise.all([
        store.set('model_favourites', modelFavourites.value),
        store.set('model_recents', modelRecents.value),
      ])
    } catch (err) {
      console.warn('[usePreferences] saveModelPreferences:', err)
    }
  }

  async function toggleModelFavourite(model: ModelPreference) {
    modelFavourites.value = toggleFavouriteModel(modelFavourites.value, model)
    await saveModelPreferences()
  }

  async function recordModelRecent(model: ModelPreference) {
    modelRecents.value = recordRecentModel(modelRecents.value, model)
    await saveModelPreferences()
  }

  return {
    appearance,
    modelFavourites,
    modelRecents,
    init,
    setAppearance,
    toggleModelFavourite,
    recordModelRecent,
  }
}

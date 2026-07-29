import { ref } from 'vue'
import { load } from '@tauri-apps/plugin-store'

export type Appearance = 'system' | 'dark' | 'light'

const appearance = ref<Appearance>('system')
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

  return { appearance, init, setAppearance }
}

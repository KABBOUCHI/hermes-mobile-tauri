import { ref, computed } from 'vue'
import { Store } from '@tauri-apps/plugin-store'

const store = ref<Store | null>(null)
const gatewayUrl = ref('')
const username = ref('')
const password = ref('')
const isConnected = ref(false)

export function useAuth() {
  const authHeader = computed(() => {
    if (!username.value || !password.value) return ''
    return 'Basic ' + btoa(username.value + ':' + password.value)
  })

  async function initStore() {
    if (!store.value) {
      store.value = await Store.load('settings.json')
    }
    return store.value
  }

  async function loadSavedCredentials() {
    const s = await initStore()
    const savedUrl = await s.get<string>('gateway_url')
    const savedUser = await s.get<string>('gateway_user')
    const savedPass = await s.get<string>('gateway_pass')

    if (savedUrl) gatewayUrl.value = savedUrl
    if (savedUser) username.value = savedUser
    if (savedPass) password.value = savedPass

    return !!(savedUrl && savedUser && savedPass)
  }

  async function saveCredentials() {
    const s = await initStore()
    await s.set('gateway_url', gatewayUrl.value)
    await s.set('gateway_user', username.value)
    await s.set('gateway_pass', password.value)
    await s.save()
  }

  async function clearCredentials() {
    const s = await initStore()
    await s.delete('gateway_url')
    await s.delete('gateway_user')
    await s.delete('gateway_pass')
    await s.save()

    gatewayUrl.value = ''
    username.value = ''
    password.value = ''
    isConnected.value = false
  }

  async function fetchStatus(): Promise<any> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const response = await fetch(`${base}/api/status`, {
      method: 'GET',
      headers: { 'Authorization': authHeader.value },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  }

  async function connect(): Promise<void> {
    if (!gatewayUrl.value.trim()) {
      throw new Error('Please enter a gateway URL')
    }
    await fetchStatus()
    await saveCredentials()
    isConnected.value = true
  }

  async function tryAutoLogin(): Promise<boolean> {
    const hasCreds = await loadSavedCredentials()
    if (!hasCreds) return false

    try {
      await fetchStatus()
      isConnected.value = true
      return true
    } catch {
      return false
    }
  }

  function buildHeaders(): Record<string, string> {
    const h: Record<string, string> = {}
    if (authHeader.value) h['Authorization'] = authHeader.value
    return h
  }

  return {
    gatewayUrl,
    username,
    password,
    isConnected,
    authHeader,
    loadSavedCredentials,
    saveCredentials,
    clearCredentials,
    fetchStatus,
    connect,
    tryAutoLogin,
    buildHeaders,
  }
}

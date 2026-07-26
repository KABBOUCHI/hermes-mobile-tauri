import { ref, computed } from 'vue'
import { Store } from '@tauri-apps/plugin-store'

const store = ref<Store | null>(null)
const gatewayUrl = ref('')
const username = ref('')
const password = ref('')
const isConnected = ref(false)

const FETCH_TIMEOUT = 8000
const STORE_TIMEOUT = 3000

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ])
}

function humanizeError(err: any, url: string): string {
  const name = err?.name || ''
  const msg = err?.message || ''

  if (name === 'AbortError' || msg.includes('timed out')) {
    return `Timeout — server didn't respond in time\n${url}`
  }
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_NETWORK')) {
    return `Network error — server unreachable\n${url}\n\nPossible causes:\n• Wrong URL or port\n• Server is down\n• CORS blocked\n• Phone not on same network`
  }
  if (msg.includes('ERR_NAME_NOT_RESOLVED')) {
    return `DNS error — hostname not found\n${url}`
  }
  if (msg.includes('ERR_CONNECTION_REFUSED')) {
    return `Connection refused — server not listening\n${url}`
  }
  if (msg.includes('ERR_SSL') || msg.includes('SSL') || msg.includes('certificate')) {
    return `SSL error — invalid certificate\n${url}`
  }
  if (msg.includes('HTTP 401')) {
    return 'Invalid username or password (401)'
  }
  if (msg.includes('HTTP 403')) {
    return 'Access denied (403)'
  }
  if (msg.includes('HTTP 404')) {
    return `Gateway not found (404)\n${url}\n\nCheck the URL — path must be exact`
  }
  if (msg.includes('HTTP 5')) {
    return `Server error (${msg.match(/HTTP \d+/)?.[0] || '5xx'})\n${url}`
  }
  return msg || 'Unknown error'
}

export function useAuth() {
  const authHeader = computed(() => {
    if (!username.value || !password.value) return ''
    return 'Basic ' + btoa(username.value + ':' + password.value)
  })

  async function initStore() {
    if (!store.value) {
      store.value = await withTimeout(
        Store.load('settings.json'),
        STORE_TIMEOUT,
        'Store.load'
      )
    }
    return store.value
  }

  async function loadSavedCredentials(): Promise<boolean> {
    try {
      const s = await initStore()
      const savedUrl = await s.get<string>('gateway_url')
      const savedUser = await s.get<string>('gateway_user')
      const savedPass = await s.get<string>('gateway_pass')

      if (savedUrl) gatewayUrl.value = savedUrl
      if (savedUser) username.value = savedUser
      if (savedPass) password.value = savedPass

      return !!(savedUrl && savedUser && savedPass)
    } catch (err) {
      console.warn('[useAuth] loadSavedCredentials:', err)
      return false
    }
  }

  async function saveCredentials() {
    try {
      const s = await initStore()
      await s.set('gateway_url', gatewayUrl.value)
      await s.set('gateway_user', username.value)
      await s.set('gateway_pass', password.value)
      await s.save()
    } catch (err) {
      console.warn('[useAuth] saveCredentials:', err)
    }
  }

  async function clearCredentials() {
    try {
      const s = await initStore()
      await s.delete('gateway_url')
      await s.delete('gateway_user')
      await s.delete('gateway_pass')
      await s.save()
    } catch {}

    gatewayUrl.value = ''
    username.value = ''
    password.value = ''
    isConnected.value = false
  }

  async function fetchStatus(): Promise<any> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const url = `${base}/api/status`
    try {
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { 'Authorization': authHeader.value },
      }, FETCH_TIMEOUT)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (err: any) {
      throw new Error(humanizeError(err, url))
    }
  }

  async function connect(): Promise<void> {
    const url = gatewayUrl.value.trim()
    if (!url) {
      throw new Error('Please enter a gateway URL')
    }
    // Auto-fix missing protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      gatewayUrl.value = 'https://' + url
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

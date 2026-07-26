import { ref } from 'vue'
import { Store } from '@tauri-apps/plugin-store'
import { fetch } from '@tauri-apps/plugin-http'

const store = ref<Store | null>(null)
const gatewayUrl = ref('')
const username = ref('')
const password = ref('')
const isConnected = ref(false)
const sessionCookie = ref('')

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

export function useAuth() {
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
      const savedCookie = await s.get<string>('session_cookie')

      if (savedUrl) gatewayUrl.value = savedUrl
      if (savedUser) username.value = savedUser
      if (savedPass) password.value = savedPass
      if (savedCookie) sessionCookie.value = savedCookie

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
      await s.set('session_cookie', sessionCookie.value)
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
      await s.delete('session_cookie')
      await s.save()
    } catch {}

    gatewayUrl.value = ''
    username.value = ''
    password.value = ''
    sessionCookie.value = ''
    isConnected.value = false
  }

  /**
   * Extract hermes_session_rt cookie from Set-Cookie header.
   */
  function extractCookie(headers: Headers): string {
    try {
      const raw = headers as any
      if (raw && typeof raw === 'object' && typeof raw.entries === 'function') {
        for (const [key, val] of raw.entries()) {
          if (key.toLowerCase() === 'set-cookie' && typeof val === 'string') {
            const match = val.match(/hermes_session_rt=([^;]+)/)
            if (match) return `hermes_session_rt=${match[1]}`
          }
        }
      }
    } catch {}
    // Fallback: try get()
    try {
      const sc = headers.get('set-cookie') || headers.get('Set-Cookie') || ''
      if (sc) {
        const match = sc.match(/hermes_session_rt=([^;]+)/)
        if (match) return `hermes_session_rt=${match[1]}`
      }
    } catch {}
    return ''
  }

  async function doLogin(): Promise<void> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const url = `${base}/auth/password-login`
    const resp = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        provider: 'basic',
        username: username.value,
        password: password.value,
        next: '',
      }),
    }, FETCH_TIMEOUT)

    // Extract session cookie for WebSocket use
    const cookie = extractCookie(resp.headers)
    if (cookie) {
      sessionCookie.value = cookie
    }
  }

  async function fetchStatus(): Promise<any> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const url = `${base}/api/status`
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      credentials: 'same-origin',
    }, FETCH_TIMEOUT)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  }

  async function fetchWsTicket(): Promise<string> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const url = `${base}/api/auth/ws-ticket`
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      credentials: 'same-origin',
    }, FETCH_TIMEOUT)
    if (!response.ok) throw new Error(`WS ticket request failed: HTTP ${response.status}`)
    const data = await response.json()
    return data.ticket || ''
  }

  async function connect(): Promise<void> {
    const url = gatewayUrl.value.trim()
    if (!url) throw new Error('Please enter a gateway URL')
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      gatewayUrl.value = 'https://' + url
    }
    await doLogin()
    await fetchStatus()
    await saveCredentials()
    isConnected.value = true
  }

  async function tryAutoLogin(): Promise<boolean> {
    const hasCreds = await loadSavedCredentials()
    if (!hasCreds) return false
    try {
      await doLogin()
      await fetchStatus()
      isConnected.value = true
      return true
    } catch {
      return false
    }
  }

  return {
    gatewayUrl,
    username,
    password,
    isConnected,
    sessionCookie,
    loadSavedCredentials,
    saveCredentials,
    clearCredentials,
    doLogin,
    fetchStatus,
    fetchWsTicket,
    connect,
    tryAutoLogin,
  }
}

import { ref } from 'vue'
import { load } from '@tauri-apps/plugin-store'
import { fetch } from '@tauri-apps/plugin-http'

// Plain variable — Vue reactivity would try to proxy private fields
let storeInstance: Awaited<ReturnType<typeof load>> | null = null

const gatewayUrl = ref('')
const username = ref('')
const password = ref('')
const isConnected = ref(false)
const sessionCookie = ref('')

const FETCH_TIMEOUT = 8000

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

async function initStore() {
  if (!storeInstance) {
    storeInstance = await load('settings.json', { autoSave: true })
  }
  return storeInstance
}

export function useAuth() {
  async function loadSavedCredentials(): Promise<boolean> {
    try {
      const s = await initStore()
      const savedUrl = (await s.get<string>('gateway_url')) || ''
      const savedUser = (await s.get<string>('gateway_user')) || ''
      const savedPass = (await s.get<string>('gateway_pass')) || ''
      const savedCookie = (await s.get<string>('session_cookie')) || ''

      gatewayUrl.value = savedUrl
      username.value = savedUser
      password.value = savedPass
      sessionCookie.value = savedCookie

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
    } catch (err) {
      console.warn('[useAuth] saveCredentials:', err)
    }
  }

  async function clearCredentials() {
    try {
      const s = await initStore()
      await s.set('gateway_url', '')
      await s.set('gateway_user', '')
      await s.set('gateway_pass', '')
      await s.set('session_cookie', '')
    } catch {}

    gatewayUrl.value = ''
    username.value = ''
    password.value = ''
    sessionCookie.value = ''
    isConnected.value = false
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

    // Extract cookie
    try {
      const setCookie = resp.headers.getSetCookie?.()
      if (setCookie && Array.isArray(setCookie)) {
        for (const raw of setCookie) {
          const match = raw.match(/hermes_session_rt=([^;]+)/)
          if (match) { sessionCookie.value = `hermes_session_rt=${match[1]}`; return }
        }
      }
    } catch {}
    try {
      const sc = resp.headers.get('set-cookie') || ''
      if (sc) {
        const match = sc.match(/hermes_session_rt=([^;]+)/)
        if (match) { sessionCookie.value = `hermes_session_rt=${match[1]}`; return }
      }
    } catch {}
  }

  async function fetchStatus(): Promise<any> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const url = `${base}/api/status`
    const headers: Record<string, string> = {}
    if (sessionCookie.value) headers['Cookie'] = sessionCookie.value
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers,
      credentials: 'same-origin',
    }, FETCH_TIMEOUT)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  }

  async function fetchWsTicket(): Promise<string> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const url = `${base}/api/auth/ws-ticket`
    const headers: Record<string, string> = {}
    if (sessionCookie.value) headers['Cookie'] = sessionCookie.value
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
    }, FETCH_TIMEOUT)
    if (!response.ok) throw new Error(`WS ticket failed: HTTP ${response.status}`)
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

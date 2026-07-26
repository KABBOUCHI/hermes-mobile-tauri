import { ref } from 'vue'
import { load } from '@tauri-apps/plugin-store'
import { fetch } from '@tauri-apps/plugin-http'

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
  async function loadSavedSession(): Promise<boolean> {
    try {
      const s = await initStore()
      const savedUrl = (await s.get<string>('gateway_url')) || ''
      const savedCookie = (await s.get<string>('session_cookie')) || ''

      if (!savedUrl || !savedCookie) return false

      gatewayUrl.value = savedUrl
      sessionCookie.value = savedCookie
      return true
    } catch (err) {
      console.warn('[useAuth] loadSavedSession:', err)
      return false
    }
  }

  async function saveSession() {
    try {
      const s = await initStore()
      await s.set('gateway_url', gatewayUrl.value)
      await s.set('session_cookie', sessionCookie.value)
    } catch (err) {
      console.warn('[useAuth] saveSession:', err)
    }
  }

  async function clearSession() {
    try {
      const s = await initStore()
      await s.set('gateway_url', '')
      await s.set('session_cookie', '')
    } catch {}

    gatewayUrl.value = ''
    sessionCookie.value = ''
    isConnected.value = false
  }

  /**
   * POST /auth/password-login → extract hermes_session_rt cookie.
   */
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

  /**
   * Full login: password → cookie → validate → save.
   */
  async function connect(): Promise<void> {
    const url = gatewayUrl.value.trim()
    if (!url) throw new Error('Please enter a gateway URL')
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      gatewayUrl.value = 'https://' + url
    }
    await doLogin()
    await fetchStatus()
    await saveSession()
    isConnected.value = true
  }

  /**
   * Reopen: try saved cookie → validate → save fresh cookie.
   */
  async function tryAutoLogin(): Promise<boolean> {
    const hasSession = await loadSavedSession()
    if (!hasSession) return false
    try {
      // Try cookie directly — no need to re-login
      await fetchStatus()
      isConnected.value = true
      return true
    } catch {
      // Cookie expired — need fresh login
      return false
    }
  }

  return {
    gatewayUrl,
    username,
    password,
    isConnected,
    sessionCookie,
    loadSavedSession,
    saveSession,
    clearSession,
    doLogin,
    fetchStatus,
    fetchWsTicket,
    connect,
    tryAutoLogin,
  }
}

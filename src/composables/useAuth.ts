import { ref } from 'vue'
import { Store } from '@tauri-apps/plugin-store'
import { fetch } from '@tauri-apps/plugin-http';

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
      await s.delete('session_cookie')
      await s.save()
    } catch {}

    gatewayUrl.value = ''
    username.value = ''
    password.value = ''
    isConnected.value = false
  }

  /**
   * Login via POST /auth/password-login → extract session cookie.
   */
  async function doLogin(): Promise<string> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const url = `${base}/auth/password-login`
    try {
     await fetchWithTimeout(url, {
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
    } catch (err) {
      console.warn('[useAuth] doLogin failed:', err)
    }
    return ''
  }

  /**
   * Validate via GET /api/status (uses cookie, Basic Auth as fallback).
   */
  async function fetchStatus(): Promise<any> {
    const base = gatewayUrl.value.replace(/\/$/, '')
    const url = `${base}/api/status`

    const headers: Record<string, string> = {}
      // headers['Authorization'] = 'Basic ' + btoa(username.value + ':' + password.value)

    const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers,
      credentials: 'same-origin',
    }, FETCH_TIMEOUT)

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  }

  /**
   * Full connect: login → validate → save.
   */
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

  /**
   * Auto-login: load saved creds → re-login → validate.
   */
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
    loadSavedCredentials,
    saveCredentials,
    clearCredentials,
    doLogin,
    fetchStatus,
    connect,
    tryAutoLogin,
  }
}

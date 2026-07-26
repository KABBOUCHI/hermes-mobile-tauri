import { ref } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'

const FETCH_TIMEOUT = 12000

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export interface Session {
  id: string
  title: string
  message_count: number
  last_active: number
  started_at: number
  model: string
  preview: string
  is_active: boolean
  source: string
}

export interface Message {
  role: string
  content: string
  timestamp: number
}

export function useGateway() {
  const sessions = ref<Session[]>([])
  const messages = ref<Message[]>([])
  const loading = ref(false)
  const error = ref('')

  function extractText(content: any): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((p: any) => p?.type === 'text')
        .map((p: any) => p.text || '')
        .join('\n') || '[non-text content]'
    }
    return String(content || '')
  }

  function relativeTime(ts: number): string {
    const now = Date.now() / 1000
    const diff = now - ts
    if (diff < 60) return 'just now'
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago'
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago'
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago'
    return Math.floor(diff / 604800) + 'w ago'
  }

  function modelShort(model: string): string {
    if (!model) return ''
    const parts = model.split('/')
    return parts[parts.length - 1]
  }

  function formatTime(ts: number): string {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    const h = d.getHours().toString().padStart(2, '0')
    const m = d.getMinutes().toString().padStart(2, '0')
    return `${h}:${m}`
  }

  async function fetchSessions(baseUrl: string): Promise<Session[]> {
    loading.value = true
    error.value = ''
    try {
      const base = baseUrl.replace(/\/$/, '')
      const url = `${base}/api/sessions?limit=40&offset=0&min_messages=1&archived=exclude&order=recent&source=desktop`
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        credentials: 'same-origin',
      }, FETCH_TIMEOUT)
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const data = await response.json()
      sessions.value = data.sessions || []
      return sessions.value
    } catch (err: any) {
      error.value = err.message || 'Failed to load sessions'
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchMessages(baseUrl: string, sessionId: string): Promise<Message[]> {
    loading.value = true
    error.value = ''
    try {
      const base = baseUrl.replace(/\/$/, '')
      const url = `${base}/api/sessions/${sessionId}/messages`
      const response = await fetchWithTimeout(url, {
        method: 'GET',
        credentials: 'same-origin',
      }, FETCH_TIMEOUT)
      if (!response.ok) throw new Error('HTTP ' + response.status)
      const data = await response.json()
      const raw = data.messages || []
      messages.value = raw
        .filter((m: any) => m.role !== 'system')
        .map((m: any) => ({
          role: m.role || 'assistant',
          content: extractText(m.content),
          timestamp: m.timestamp || 0,
        }))
      return messages.value
    } catch (err: any) {
      error.value = err.message || 'Failed to load messages'
      return []
    } finally {
      loading.value = false
    }
  }

  /**
   * Send a message via WebSocket using a fresh ticket.
   * Flow: fetch ticket → connect ws://host/api/ws?ticket=TICKET → RPC prompt.submit
   */
  async function sendMessage(
    baseUrl: string,
    sessionId: string,
    text: string,
    getTicket: () => Promise<string>,
  ): Promise<Message | null> {
    // Step 1: Get a fresh WS ticket (short-lived, ~30s)
    const ticket = await getTicket()

    const base = baseUrl.replace(/\/$/, '')
    const wsUrl = base.replace(/^http/, 'ws') + `/api/ws?ticket=${encodeURIComponent(ticket)}`

    // Step 2: Open WebSocket and send RPC
    const result = await rpcCall(wsUrl, {
      session_id: sessionId,
      prompt: text,
    })

    if (result?.response) {
      const msg: Message = {
        role: 'assistant',
        content: extractText(result.response),
        timestamp: Date.now() / 1000,
      }
      messages.value.push(msg)
      return msg
    } else if (result?.error) {
      const msg: Message = {
        role: 'assistant',
        content: 'Error: ' + result.error,
        timestamp: Date.now() / 1000,
      }
      messages.value.push(msg)
      return msg
    }
    return null
  }

  function rpcCall(wsUrl: string, params: any, timeoutMs = 180000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        try { ws.close() } catch {}
        reject(new Error('WebSocket timeout'))
      }, timeoutMs)

      let done = false
      const ws = new WebSocket(wsUrl)

      ws.onopen = () => {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'prompt.submit',
          params,
        }))
      }

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
          if (msg.id === 1 && !done) {
            done = true
            clearTimeout(timeout)
            ws.close()
            resolve(msg.error ? { error: msg.error.message || 'RPC error' } : (msg.result || msg))
          }
        } catch {}
      }

      ws.onerror = () => {
        if (!done) { done = true; clearTimeout(timeout); reject(new Error('WebSocket error')) }
      }
      ws.onclose = () => {
        if (!done) { done = true; clearTimeout(timeout); reject(new Error('WebSocket closed')) }
      }
    })
  }

  return {
    sessions,
    messages,
    loading,
    error,
    extractText,
    relativeTime,
    modelShort,
    formatTime,
    fetchSessions,
    fetchMessages,
    sendMessage,
  }
}

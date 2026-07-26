import { ref } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import WebSocket from '@tauri-apps/plugin-websocket'

const FETCH_TIMEOUT = 12000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000

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

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export function useGateway() {
  const sessions = ref<Session[]>([])
  const messages = ref<Message[]>([])
  const loading = ref(false)
  const error = ref('')
  const wsState = ref<ConnectionState>('idle')

  // Persistent WS state
  let ws: any = null
  let removeListener: (() => void) | null = null
  let reconnectAttempt = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let pendingRequests = new Map<number, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>()
  let nextId = 0

  // Config (set on connect)
  let baseUrl = ''
  let cookie = ''
  let ticketFn: (() => Promise<string>) | null = null

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
    return model.split('/').pop() || model
  }

  function formatTime(ts: number): string {
    if (!ts) return ''
    const d = new Date(ts * 1000)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  // ── REST ──────────────────────────────────────────────

  async function fetchSessions(url: string): Promise<Session[]> {
    loading.value = true
    error.value = ''
    try {
      const base = url.replace(/\/$/, '')
      const headers: Record<string, string> = {}
      if (cookie) headers['Cookie'] = cookie
      const resp = await fetchWithTimeout(
        `${base}/api/sessions?limit=40&offset=0&min_messages=1&archived=exclude&order=recent&source=desktop`,
        { method: 'GET', headers, credentials: 'same-origin' },
        FETCH_TIMEOUT
      )
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const data = await resp.json()
      sessions.value = data.sessions || []
      return sessions.value
    } catch (err: any) {
      error.value = err.message || 'Failed to load sessions'
      return []
    } finally {
      loading.value = false
    }
  }

  async function fetchMessages(url: string, sessionId: string): Promise<Message[]> {
    loading.value = true
    error.value = ''
    try {
      const base = url.replace(/\/$/, '')
      const headers: Record<string, string> = {}
      if (cookie) headers['Cookie'] = cookie
      const resp = await fetchWithTimeout(
        `${base}/api/sessions/${sessionId}/messages`,
        { method: 'GET', headers, credentials: 'same-origin' },
        FETCH_TIMEOUT
      )
      if (!resp.ok) throw new Error('HTTP ' + resp.status)
      const data = await resp.json()
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

  // ── Persistent WebSocket ──────────────────────────────

  async function connectWs(url: string, sessCookie: string, getTicket: () => Promise<string>) {
    baseUrl = url
    cookie = sessCookie
    ticketFn = getTicket
    disposed = false
    await openWs()
  }

  async function openWs() {
    if (disposed) return
    if (ws) {
      try { ws.disconnect() } catch {}
      ws = null
    }

    wsState.value = 'connecting'

    try {
      const ticket = await ticketFn!()
      const base = baseUrl.replace(/\/$/, '')
      const wsUrl = base.replace(/^http/, 'ws') + `/api/ws?ticket=${encodeURIComponent(ticket)}`

      const headers: Record<string, string> = {}
      if (cookie) headers['Cookie'] = cookie

      ws = await WebSocket.connect(wsUrl, { headers })
      console.log('[ws] connected to:', wsUrl.slice(0, 80))
      reconnectAttempt = 0
      wsState.value = 'open'

      removeListener = ws.addListener((event: any) => {
        console.log('[ws] raw event:', JSON.stringify(event)?.slice(0, 300))
        try {
          const raw = typeof event === 'string' ? event : event?.data || event?.payload || String(event)
          console.log('[ws] parsed raw:', typeof raw, raw?.slice?.(0, 300))
          const msg = JSON.parse(raw)
          console.log('[ws] msg:', JSON.stringify(msg).slice(0, 300))

          // JSON-RPC response (has id)
          if (msg.id !== undefined && msg.id !== null) {
            const pending = pendingRequests.get(msg.id)
            if (pending) {
              clearTimeout(pending.timer)
              pendingRequests.delete(msg.id)
              if (msg.error) {
                pending.reject(new Error(msg.error.message || 'RPC error'))
              } else {
                pending.resolve(msg.result || msg)
              }
            }
          }

          // Gateway event (has method + params)
          if (msg.method === 'event' && msg.params?.type) {
            handleGatewayEvent(msg.params)
          }
        } catch {}
      })
    } catch (err) {
      console.error('[ws] connect failed:', err)
      wsState.value = 'error'
      scheduleReconnect()
    }
  }

  function handleGatewayEvent(event: any) {
    // Handle streaming events if needed
    // For now, just log them
    console.debug('[ws] event:', event.type, event)
  }

  function scheduleReconnect() {
    if (disposed || reconnectTimer !== null) return
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt)
    reconnectAttempt++
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      openWs()
    }, delay)
  }

  function disconnectWs() {
    disposed = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (removeListener) {
      removeListener()
      removeListener = null
    }
    if (ws) {
      try { ws.disconnect() } catch {}
      ws = null
    }
    pendingRequests.forEach(p => {
      clearTimeout(p.timer)
      p.reject(new Error('WebSocket closed'))
    })
    pendingRequests.clear()
    wsState.value = 'closed'
  }

  /**
   * JSON-RPC request over the persistent WS.
   */
  function rpcRequest(method: string, params: any, timeoutMs = 180000): Promise<any> {
    console.log('[rpc] sending:', method, JSON.stringify(params).slice(0, 200))
    console.log('[rpc] ws state:', wsState.value, 'ws exists:', !!ws)
    return new Promise((resolve, reject) => {
      if (!ws || wsState.value !== 'open') {
        reject(new Error('WebSocket not connected'))
        return
      }

      const id = ++nextId

      const timer = setTimeout(() => {
        pendingRequests.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, timeoutMs)

      pendingRequests.set(id, { resolve, reject, timer })

      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      })).then(() => {
        console.log('[rpc] sent ok, id:', id)
      }).catch((err: any) => {
        clearTimeout(timer)
        pendingRequests.delete(id)
        reject(err)
      })
    })
  }

  /**
   * Send a message — uses the persistent WS connection.
   */
  async function sendMessage(
    _url: string,
    sessionId: string,
    text: string,
  ): Promise<Message | null> {
    const result = await rpcRequest('prompt.submit', {
      session_id: sessionId,
      text,
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

  /**
   * Delete a session via REST.
     */
    async function deleteSession(url: string, sessionId: string): Promise<boolean> {
      try {
        const base = url.replace(/\/$/, '')
        const headers: Record<string, string> = {}
        if (cookie) headers['Cookie'] = cookie
        const resp = await fetchWithTimeout(
          `${base}/api/sessions/${encodeURIComponent(sessionId)}`,
          { method: 'DELETE', headers, credentials: 'same-origin' },
          FETCH_TIMEOUT
        )
        if (!resp.ok) throw new Error('HTTP ' + resp.status)
        sessions.value = sessions.value.filter(s => s.id !== sessionId)
        return true
      } catch (err: any) {
        error.value = err.message || 'Failed to delete session'
        return false
      }
    }

  return {
    sessions,
    messages,
    loading,
    error,
    wsState,
    extractText,
    relativeTime,
    modelShort,
    formatTime,
    fetchSessions,
    fetchMessages,
    deleteSession,
    connectWs,
    disconnectWs,
    sendMessage,
  }
}

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

  // Streaming turn state
  let activeTurn: { sessionId: string; resolve: (content: string) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null
  let streamingContent = ''

  // Config
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
      reconnectAttempt = 0
      wsState.value = 'open'

      removeListener = ws.addListener((event: any) => {
        try {
          let raw: string
          if (typeof event === 'string') {
            raw = event
          } else if (event?.type === 'Text' && typeof event?.data === 'string') {
            raw = event.data
          } else {
            raw = event?.data || event?.payload || String(event)
          }
          const msg = JSON.parse(raw)

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

          // Gateway event
          if (msg.method === 'event' && msg.params) {
            handleGatewayEvent(msg.params)
          }
        } catch {}
      })
    } catch (err) {
      wsState.value = 'error'
      scheduleReconnect()
    }
  }

  function handleGatewayEvent(event: any) {
    const type = event.type as string
    const sessionId = event.session_id

    if (type === 'message.delta' && activeTurn && sessionId === activeTurn.sessionId) {
      const delta = event.payload?.text || event.payload?.content || ''
      if (delta) {
        streamingContent += delta
        const last = messages.value[messages.value.length - 1]
        if (last && last.role === 'assistant') {
          last.content = streamingContent
        }
      }
    }

    if (type === 'message.complete' && activeTurn && sessionId === activeTurn.sessionId) {
      clearTimeout(activeTurn.timer)
      const content = streamingContent || event.payload?.content || ''
      const resolve = activeTurn.resolve
      activeTurn = null
      streamingContent = ''
      resolve(content)
    }

    if (type === 'error' && activeTurn && sessionId === activeTurn.sessionId) {
      clearTimeout(activeTurn.timer)
      const errMsg = event.payload?.message || event.payload?.error || 'Turn failed'
      const reject = activeTurn.reject
      activeTurn = null
      streamingContent = ''
      reject(new Error(errMsg))
    }
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
    if (activeTurn) {
      clearTimeout(activeTurn.timer)
      activeTurn.reject(new Error('WebSocket closed'))
      activeTurn = null
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
    streamingContent = ''
    wsState.value = 'closed'
  }

  /**
   * Raw RPC call over the persistent WS.
   */
  function rpcCall(method: string, params: any, timeoutMs = 120000): Promise<any> {
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
      })).catch((err: any) => {
        clearTimeout(timer)
        pendingRequests.delete(id)
        reject(err)
      })
    })
  }

  /**
   * Resume a session via WS to get the runtimeId.
   * session.resume → { session_id: runtimeId, messages, info, ... }
   */
  async function resumeSession(storedSessionId: string): Promise<string> {
    const result = await rpcCall('session.resume', {
      session_id: storedSessionId,
      cols: 96,
      source: 'desktop',
    })
    const runtimeId = result?.session_id
    if (!runtimeId) throw new Error('session.resume returned no session id')
    return runtimeId
  }

  /**
   * Send a message via the persistent WS.
   *
   * 1. session.resume → get runtimeId
   * 2. Push placeholder assistant message
   * 3. prompt.submit (fire-and-forget) → ack {status: "streaming"}
   * 4. Collect message.delta events → update placeholder
   * 5. Resolve on message.complete
   */
  async function sendMessage(
    _url: string,
    sessionId: string,
    text: string,
  ): Promise<Message | null> {
    if (!ws || wsState.value !== 'open') {
      throw new Error('WebSocket not connected')
    }

    // Resume session to get runtimeId
    const runtimeId = await resumeSession(sessionId)

    // Push placeholder assistant message
    const assistantMsg: Message = {
      role: 'assistant',
      content: '',
      timestamp: Date.now() / 1000,
    }
    messages.value.push(assistantMsg)

    // Set up streaming turn
    streamingContent = ''

    const content = await new Promise<string>((resolve, reject) => {
      const TURN_TIMEOUT = 1_800_000
      const timer = setTimeout(() => {
        activeTurn = null
        streamingContent = ''
        reject(new Error('Turn timed out'))
      }, TURN_TIMEOUT)

      activeTurn = { sessionId: runtimeId, resolve, reject, timer }

      // Fire prompt.submit
      const id = ++nextId
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'prompt.submit',
        params: { session_id: runtimeId, text },
      })).catch((err: any) => {
        clearTimeout(timer)
        activeTurn = null
        streamingContent = ''
        reject(err)
      })
    })

    assistantMsg.content = content || '[empty response]'
    return assistantMsg
  }

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

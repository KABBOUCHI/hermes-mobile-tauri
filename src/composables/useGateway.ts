import { ref, computed } from 'vue'
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
  title: string | null
  preview: string
  model: string
  message_count: number
  last_active: number
  started_at: number
  is_active: boolean
  source: string
}

export interface Message {
  role: string
  content: string
  timestamp: number
}

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

// ── Module-level singleton state ───────────────────
const sessions = ref<Session[]>([])
const messages = ref<Message[]>([])
const loadingSessions = ref(false)
const loadingMessages = ref(false)
const error = ref('')
const wsState = ref<ConnectionState>('idle')
const turnStartedAt = ref<number | null>(null)

const loading = computed(() => loadingSessions.value || loadingMessages.value)

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

const activeRuntimeId = computed(() => activeTurn?.sessionId ?? null)

// ── Helpers ────────────────────────────────────────

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (content === null || content === undefined) return ''
  if (Array.isArray(content)) {
    // Filter to text parts only, skip tool-call/tool-result parts
    return content
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n') || ''
  }
  if (typeof content === 'object') {
    // Skip tool-call / tool-use objects
    if (content.type === 'tool-call' || content.type === 'tool_use' || content.type === 'tool-result') return ''
    if (content.name && (content.input || content.arguments)) return ''
    // Try common text fields (match desktop app's textFromUnknown)
    const text = content.text ?? content.output_text ?? content.output ?? content.content ?? content.message ?? content.summary ?? content.rendered
    if (typeof text === 'string') return text
    if (Array.isArray(text)) return extractText(text)
    if (text && typeof text === 'object') return extractText(text)
    // If it has an 'error' boolean field with a string 'error' field, return the error
    if (typeof content.error === 'string') return `Error: ${content.error}`
    // If it has 'result' field, try that
    if (content.result !== undefined) return extractText(content.result)
    // Don't stringify raw objects — they're tool outputs, not display text
    return ''
  }
  return String(content || '')
}

/** Extract displayable text from a raw gateway message */
function displayContent(msg: any): string {
  const kind = msg.display_kind
  // Skip hidden, timeline, and system-kind messages
  if (kind === 'hidden' || kind === 'model_switch' || kind === 'auto_continue' || kind === 'async_delegation_complete') return ''
  // Skip tool-call-only messages (no text content)
  const content = msg.content
  if (Array.isArray(content)) {
    const hasText = content.some((p: any) => p?.type === 'text' && p.text?.trim())
    if (!hasText) return ''
  }
  let text = extractText(content)
  // Strip <think>...</think> blocks (completed)
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  // Strip open <think> blocks (streaming — no closing tag)
  text = text.replace(/<think>[\s\S]*$/gi, '')
  // Strip <tool_call>...</tool_call> blocks
  text = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
  // Strip <result>...</result> wrappers from tool results
  text = text.replace(/<result>[\s\S]*?<\/result>/gi, (m: string) => {
    const inner = m.replace(/<\/?result>/gi, '').trim()
    return inner.length < 500 ? inner : inner.slice(0, 500) + '…'
  })
  return text.trim()
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

// ── REST ───────────────────────────────────────────

async function fetchSessions(url: string): Promise<Session[]> {
  loadingSessions.value = true
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
    loadingSessions.value = false
  }
}

async function fetchMessages(url: string, sessionId: string): Promise<Message[]> {
  loadingMessages.value = true
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
      .filter((m: any) => m.role !== 'system' && m.role !== 'tool' && m.role !== 'function')
      .map((m: any) => ({
        role: m.role || 'assistant',
        content: displayContent(m),
        timestamp: m.timestamp || 0,
      }))
      .filter((m: any) => m.content.trim() !== '')
    return messages.value
  } catch (err: any) {
    error.value = err.message || 'Failed to load messages'
    return []
  } finally {
    loadingMessages.value = false
  }
}

// ── Persistent WebSocket ───────────────────────────

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
    turnStartedAt.value = null
    resolve(content)
  }

  if (type === 'error' && activeTurn && sessionId === activeTurn.sessionId) {
    clearTimeout(activeTurn.timer)
    const errMsg = event.payload?.message || event.payload?.error || 'Turn failed'
    const reject = activeTurn.reject
    activeTurn = null
    streamingContent = ''
    turnStartedAt.value = null
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
  turnStartedAt.value = null
  wsState.value = 'closed'
}

// ── RPC ────────────────────────────────────────────

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

async function createSession(): Promise<{ runtimeId: string; storedSessionId: string | null }> {
  const result = await rpcCall('session.create', {
    cols: 96,
    source: 'desktop',
  })
  const runtimeId = result?.session_id
  if (!runtimeId) throw new Error('session.create returned no session id')
  return { runtimeId, storedSessionId: result?.stored_session_id ?? null }
}

async function sendMessage(
  _url: string,
  sessionId: string,
  text: string,
  isNewSession: boolean = false,
): Promise<{ message: Message; newSessionId: string | null } | null> {
  if (!ws || wsState.value !== 'open') {
    throw new Error('WebSocket not connected')
  }

  let runtimeId: string
  if (isNewSession) {
    const created = await createSession()
    runtimeId = created.runtimeId
    if (created.storedSessionId) {
      sessionId = created.storedSessionId
    }
  } else {
    runtimeId = await resumeSession(sessionId)
  }

  const assistantMsg: Message = {
    role: 'assistant',
    content: '',
    timestamp: Date.now() / 1000,
  }
  messages.value.push(assistantMsg)

  streamingContent = ''
  turnStartedAt.value = Date.now()

  const content = await new Promise<string>((resolve, reject) => {
    const TURN_TIMEOUT = 1_800_000
    const timer = setTimeout(() => {
      activeTurn = null
      streamingContent = ''
      turnStartedAt.value = null
      reject(new Error('Turn timed out'))
    }, TURN_TIMEOUT)

    activeTurn = { sessionId: runtimeId, resolve, reject, timer }

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
  return { message: assistantMsg, newSessionId: isNewSession ? sessionId : null }
}

async function interruptSession(sessionId: string): Promise<void> {
  try {
    await rpcCall('session.interrupt', { session_id: sessionId })
  } catch {
    // Best-effort
  }
}

async function regenerateLastMessage(
  _url: string,
  sessionId: string,
): Promise<Message | null> {
  if (!ws || wsState.value !== 'open') {
    throw new Error('WebSocket not connected')
  }

  const userMsgs = messages.value
    .map((m, i) => ({ msg: m, idx: i }))
    .filter(x => x.msg.role === 'user')

  if (userMsgs.length === 0) {
    throw new Error('No user messages to regenerate')
  }

  const lastUserEntry = userMsgs[userMsgs.length - 1]
  const lastUserText = lastUserEntry.msg.content
  const userOrdinal = userMsgs.length - 1

  const runtimeId = await resumeSession(sessionId)

  messages.value = messages.value.slice(0, lastUserEntry.idx)

  await interruptSession(runtimeId)

  const assistantMsg: Message = {
    role: 'assistant',
    content: '',
    timestamp: Date.now() / 1000,
  }
  messages.value.push(assistantMsg)

  streamingContent = ''
  turnStartedAt.value = Date.now()

  const content = await new Promise<string>((resolve, reject) => {
    const TURN_TIMEOUT = 1_800_000
    const timer = setTimeout(() => {
      activeTurn = null
      streamingContent = ''
      turnStartedAt.value = null
      reject(new Error('Turn timed out'))
    }, TURN_TIMEOUT)

    activeTurn = { sessionId: runtimeId, resolve, reject, timer }

    const id = ++nextId
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'prompt.submit',
      params: {
        session_id: runtimeId,
        text: lastUserText,
        truncate_before_user_ordinal: userOrdinal,
      },
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

async function renameSession(sessionId: string, title: string): Promise<boolean> {
  try {
    const base = baseUrl.replace(/\/$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', headers, credentials: 'same-origin', body: JSON.stringify({ title }) },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const s = sessions.value.find(s => s.id === sessionId)
    if (s) s.title = title
    return true
  } catch (err: any) {
    error.value = err.message || 'Failed to rename session'
    return false
  }
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

// ── Composable ─────────────────────────────────────

export function useGateway() {
  return {
    sessions,
    messages,
    loading,
    error,
    wsState,
    turnStartedAt,
    activeRuntimeId,
    extractText,
    relativeTime,
    modelShort,
    formatTime,
    fetchSessions,
    fetchMessages,
    deleteSession,
    renameSession,
    connectWs,
    disconnectWs,
    createSession,
    sendMessage,
    interruptSession,
    regenerateLastMessage,
  }
}

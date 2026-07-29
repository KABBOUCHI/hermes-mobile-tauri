import { ref, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import WebSocket from '@tauri-apps/plugin-websocket'
import { normalizeSessionMessages, completionFailure, truncateBeforeUserParams, userOrdinalAtMessageIndex, type SessionMessage } from '../utils/sessionMessages'
import { mergeSessionsById } from '../utils/sessionList'

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

/** A full-text match returned by the gateway for a session outside the loaded page. */
export interface SessionSearchResult {
  lineage_root?: string | null
  model: string | null
  role: string | null
  session_id: string
  session_started: number | null
  snippet: string
  source: string | null
}

export type Message = SessionMessage

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

// ── Module-level singleton state ───────────────────
const sessions = ref<Session[]>([])
const messages = ref<Message[]>([])
const loadingSessions = ref(false)
const loadingMore = ref(false)
const loadingMessages = ref(false)
const error = ref('')
const wsState = ref<ConnectionState>('idle')
const turnStartedAt = ref<number | null>(null)
let sessionsTotal = 0
let sessionsOffset = 0
let archivedSessionsTotal = 0
let archivedSessionsOffset = 0
// A message request can finish after the user has opened another session. Keep
// only the newest request authoritative so an older thread cannot replace it.
let messageFetchGeneration = 0
// Fast navigation cache only. The gateway remains authoritative and every
// selection revalidates, so another Hermes surface cannot leave us stale.
const messageCache = new Map<string, Message[]>()
const MESSAGE_CACHE_LIMIT = 12

function rememberMessages(sessionId: string, incoming: Message[]) {
  messageCache.delete(sessionId)
  messageCache.set(sessionId, incoming)
  if (messageCache.size > MESSAGE_CACHE_LIMIT) {
    const oldest = messageCache.keys().next().value
    if (oldest) messageCache.delete(oldest)
  }
}

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

// ── Source labels (mirrors desktop session-source.ts) ──
const SOURCE_LABELS: Record<string, string> = {
  api_server: 'API',
  cli: 'CLI',
  codex: 'Codex',
  desktop: 'Desktop',
  discord: 'Discord',
  email: 'Email',
  gateway: 'Gateway',
  local: 'Local',
  matrix: 'Matrix',
  mattermost: 'Mattermost',
  qqbot: 'QQ',
  signal: 'Signal',
  slack: 'Slack',
  sms: 'SMS',
  telegram: 'Telegram',
  tui: 'TUI',
  webhook: 'Webhook',
  weixin: 'WeChat',
  whatsapp: 'WhatsApp',
  yuanbao: 'Yuanbao',
  homeassistant: 'HA',
  bluebubbles: 'iMessage',
  dingtalk: 'DingTalk',
  feishu: 'Feishu',
  wecom: 'WeCom',
}

function sourceLabel(source: string | null | undefined): string {
  if (!source) return ''
  const id = source.toLowerCase().trim()
  return SOURCE_LABELS[id] || id.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// ── REST ───────────────────────────────────────────

const PAGE_SIZE = 40

async function fetchSessions(url: string, append = false, archived: 'exclude' | 'only' = 'exclude'): Promise<Session[]> {
  if (append) {
    loadingMore.value = true
  } else {
    loadingSessions.value = true
    if (archived === 'only') {
      archivedSessionsOffset = 0
    } else {
      sessionsOffset = 0
    }
  }
  error.value = ''
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/sessions?limit=${PAGE_SIZE}&offset=${append ? (archived === 'only' ? archivedSessionsOffset : sessionsOffset) : 0}&min_messages=1&archived=${archived}&order=recent&source=desktop`,
      { method: 'GET', headers, credentials: 'same-origin' },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    const incoming = data.sessions || []
    if (archived === 'only') {
      archivedSessionsTotal = data.total ?? incoming.length
      archivedSessionsOffset += incoming.length
    } else {
      sessionsTotal = data.total ?? incoming.length
      sessionsOffset += incoming.length
    }
    if (append) {
      // A session can move between pages while the gateway is updating its
      // recent-activity index. Reconcile overlap rather than rendering it twice.
      sessions.value = mergeSessionsById(sessions.value, incoming)
    } else {
      sessions.value = incoming
    }
    return sessions.value
  } catch (err: any) {
    error.value = err.message || 'Failed to load sessions'
    return []
  } finally {
    loadingSessions.value = false
    loadingMore.value = false
  }
}

/**
 * Search the gateway's full session index. The list endpoint is paginated, so
 * client-side filtering alone cannot find older conversations.
 */
async function searchSessions(url: string, query: string): Promise<SessionSearchResult[]> {
  const q = query.trim()
  if (!q) return []

  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/sessions/search?q=${encodeURIComponent(q)}`,
      { method: 'GET', headers, credentials: 'same-origin' },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    return Array.isArray(data.results) ? data.results : []
  } catch {
    // Search remains useful for already-loaded rows when the index is unavailable.
    return []
  }
}

function hasMoreSessions(): boolean {
  return sessionsOffset < sessionsTotal
}

function hasMoreArchivedSessions(): boolean {
  return archivedSessionsOffset < archivedSessionsTotal
}

async function fetchMessages(url: string, sessionId: string): Promise<Message[]> {
  const generation = ++messageFetchGeneration
  const cached = messageCache.get(sessionId)
  if (cached) {
    // Publish immediately, then reconcile with the authoritative response.
    messages.value = cached
  }
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
    const incoming = normalizeSessionMessages(raw)

    // Navigation may have started a newer fetch while this request was in
    // flight. Preserve the foreground thread in that case.
    if (generation !== messageFetchGeneration) return []
    rememberMessages(sessionId, incoming)
    messages.value = incoming
    return incoming
  } catch (err: any) {
    if (generation === messageFetchGeneration) {
      error.value = err.message || 'Failed to load messages'
    }
    return []
  } finally {
    if (generation === messageFetchGeneration) {
      loadingMessages.value = false
    }
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
    const failure = completionFailure(event.payload)
    const resolve = activeTurn.resolve
    const reject = activeTurn.reject
    activeTurn = null
    streamingContent = ''
    turnStartedAt.value = null
    if (failure) {
      reject(new Error(failure.message))
    } else {
      resolve(content)
    }
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

  // Mirror desktop's optimistic reload: retain the prompt while replacing only
  // the response branch. The gateway truncates and re-submits this same turn.
  messages.value = messages.value.slice(0, lastUserEntry.idx + 1)

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
        ...truncateBeforeUserParams(userOrdinal),
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

/**
 * Restore a previous user turn as the active checkpoint. Desktop uses the same
 * truncating resubmit: discard that prompt and its descendants, then run the
 * original text again so the server and every Hermes surface agree on history.
 */
async function restoreMessage(
  _url: string,
  sessionId: string,
  msgIndex: number,
): Promise<Message | null> {
  if (!ws || wsState.value !== 'open') {
    throw new Error('WebSocket not connected')
  }

  const userMessage = messages.value[msgIndex]
  const userOrdinal = userOrdinalAtMessageIndex(messages.value, msgIndex)
  if (!userMessage || userOrdinal === null || !userMessage.content.trim()) {
    throw new Error('Could not restore this message')
  }

  const runtimeId = await resumeSession(sessionId)
  messages.value = messages.value.slice(0, msgIndex + 1)

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
        text: userMessage.content,
        ...truncateBeforeUserParams(userOrdinal),
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

/** Edit a user message at the given index and resend from that point. */
async function editMessage(
  _url: string,
  sessionId: string,
  msgIndex: number,
  newText: string,
): Promise<Message | null> {
  if (!ws || wsState.value !== 'open') {
    throw new Error('WebSocket not connected')
  }

  const msg = messages.value[msgIndex]
  if (!msg || msg.role !== 'user') {
    throw new Error('No user message at that index')
  }

  // Count user messages up to (but not including) this index to get the ordinal
  let userOrdinal = 0
  for (let i = 0; i < msgIndex; i++) {
    if (messages.value[i].role === 'user') userOrdinal++
  }

  const runtimeId = await resumeSession(sessionId)

  // Truncate: keep everything up to and including this user message, remove assistant responses after
  // Find the end of this user message's block (next user message or end)
  let truncateIdx = msgIndex + 1
  while (truncateIdx < messages.value.length && messages.value[truncateIdx].role !== 'user') {
    truncateIdx++
  }
  messages.value = messages.value.slice(0, truncateIdx)

  // Update the user message content with the edited text
  messages.value[msgIndex].content = newText

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
        text: newText,
        ...truncateBeforeUserParams(userOrdinal),
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

async function archiveSession(url: string, sessionId: string): Promise<boolean> {
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', headers, credentials: 'same-origin', body: JSON.stringify({ archived: true }) },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
    return true
  } catch (err: any) {
    error.value = err.message || 'Failed to archive session'
    return false
  }
}

async function unarchiveSession(url: string, sessionId: string): Promise<boolean> {
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', headers, credentials: 'same-origin', body: JSON.stringify({ archived: false }) },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    sessions.value = sessions.value.filter(s => s.id !== sessionId)
    return true
  } catch (err: any) {
    error.value = err.message || 'Failed to unarchive session'
    return false
  }
}

// ── Model Options ──────────────────────────────────

export interface ModelProvider {
  slug: string
  name: string
  models: string[]
  is_current?: boolean
  authenticated?: boolean
}

export interface ModelOptions {
  model?: string
  provider?: string
  providers: ModelProvider[]
}

async function fetchModels(url: string): Promise<ModelOptions> {
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/model/options?explicit_only=1`,
      { method: 'GET', headers, credentials: 'same-origin' },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    return {
      model: data.model || '',
      provider: data.provider || '',
      providers: data.providers || [],
    }
  } catch (err: any) {
    error.value = err.message || 'Failed to load models'
    return { providers: [] }
  }
}

async function setModel(url: string, provider: string, model: string): Promise<boolean> {
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/model/set`,
      { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify({ scope: 'main', provider, model }) },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    return true
  } catch (err: any) {
    error.value = err.message || 'Failed to set model'
    return false
  }
}

// ── Composable ─────────────────────────────────────

export function useGateway() {
  return {
    sessions,
    messages,
    loading,
    loadingSessions,
    loadingMessages,
    loadingMore,
    error,
    wsState,
    turnStartedAt,
    activeRuntimeId,
    extractText,
    relativeTime,
    modelShort,
    formatTime,
    sourceLabel,
    fetchSessions,
    searchSessions,
    hasMoreSessions,
    hasMoreArchivedSessions,
    fetchMessages,
    deleteSession,
    archiveSession,
    unarchiveSession,
    renameSession,
    connectWs,
    disconnectWs,
    createSession,
    sendMessage,
    interruptSession,
    regenerateLastMessage,
    restoreMessage,
    editMessage,
    fetchModels,
    setModel,
  }
}

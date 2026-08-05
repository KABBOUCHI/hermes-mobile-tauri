import { ref, computed } from 'vue'
import { fetch } from '@tauri-apps/plugin-http'
import WebSocket from '@tauri-apps/plugin-websocket'
import { normalizeSessionMessages, branchableMessageHistory, completionFailure, finalizeInterruptedMessages, sealInterimAssistantMessage, truncateBeforeUserParams, userOrdinalAtMessageIndex, applyEditedUserTurn, rewindToMessage, updateStreamingReasoning, type SessionMessage } from '../utils/sessionMessages'
import { mergeSessionPage, optimisticSessionForSend, mergeSessionsById } from '../utils/sessionList'
import { resolveGatewayEventSessionId } from '../utils/gatewayEvents'
import { normalizeClarifyRequest, type ClarifyRequest } from '../utils/clarify'
import { clearInFlightTurn, persistInFlightTurn, recoverInFlightTurn } from '../utils/inflightTurnJournal'
import { buildSessionListKeepIds } from '../utils/sessionKeep'
import { base64FromDataUrl, buildAttachmentPrompt, type PendingAttachment } from '../utils/composerAttachments'
import { runtimeIdForStoredSession } from '../utils/sessionRename'
import { normalizeContextUsage, type ContextUsage } from '../utils/contextUsage'
import { normalizeProjectTreePayload, normalizeProjectsPayload, projectCreateParams, projectSessionCreateParams, type Project } from '../utils/projects'
import { settledTurnActivity } from '../utils/turnActivity'
import { offlineCache, offlineCacheScopeKey } from '../utils/offlineCache'

const FETCH_TIMEOUT = 12000
// A session transcript can contain hundreds of durable tool records. On a
// mobile connection it must not inherit the short deadline intended for small
// status and session-list requests.
export const MESSAGE_FETCH_TIMEOUT = 60000
// Desktop allows remote TTS synthesis and base64 encoding several minutes for
// long replies instead of using the short timeout for ordinary API calls.
export const AUDIO_SPEAK_MIN_REQUEST_TIMEOUT_MS = 180000
export const AUDIO_SPEAK_MAX_REQUEST_TIMEOUT_MS = 600000
const AUDIO_SPEAK_TIMEOUT_MS_PER_CHAR = 35

export function audioSpeakRequestTimeoutMs(text: string): number {
  const estimated = Math.max(
    AUDIO_SPEAK_MIN_REQUEST_TIMEOUT_MS,
    Math.ceil(String(text || '').length * AUDIO_SPEAK_TIMEOUT_MS_PER_CHAR),
  )
  return Math.min(estimated, AUDIO_SPEAK_MAX_REQUEST_TIMEOUT_MS)
}
// Desktop refreshes the sidebar shortly after a turn completes. Coalescing
// nearby completions avoids a request burst when multiple background sessions
// finish together while still making new sessions and previews appear quickly.
export const SESSION_REFRESH_DEBOUNCE_MS = 300

/**
 * The desktop sidebar reconciles after every stored turn, not only turns sent
 * by the currently focused window. Background completions can change a
 * session's preview, title, count, and recency just as much as a local send.
 */
export function shouldRefreshSessionsForEvent(type: string, sessionId: unknown): boolean {
  return type === 'message.complete' && typeof sessionId === 'string' && sessionId.trim().length > 0
}

/**
 * Desktop submits an idle rewind directly. Interrupting an idle runtime first
 * can leave a stale interrupt flag that cancels the replacement prompt. Only
 * interrupt when this client still owns the same live runtime.
 */
export function shouldInterruptBeforeRewind(activeRuntimeId: string | null, resumedRuntimeId: string): boolean {
  return Boolean(activeRuntimeId && resumedRuntimeId && activeRuntimeId === resumedRuntimeId)
}

export type SessionRedirectResult = 'redirected' | 'queued'

/** Match Desktop's mid-turn correction request exactly. */
export function sessionRedirectParams(runtimeSessionId: string, text: string): { session_id: string; text: string } {
  return {
    session_id: runtimeSessionId.trim(),
    text: text.trim(),
  }
}

/** Keep the gateway's two accepted redirect outcomes explicit at the boundary. */
export function sessionRedirectResult(payload: unknown): SessionRedirectResult | null {
  if (!payload || typeof payload !== 'object') return null
  const status = (payload as Record<string, unknown>).status
  return status === 'redirected' || status === 'queued' ? status : null
}

function isSessionNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /session not found|\b404\b/i.test(message)
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

export interface Session {
  id: string
  _lineage_root_id?: string | null
  parent_session_id?: string | null
  cwd?: string | null
  git_branch?: string | null
  git_repo_root?: string | null
  title: string | null
  preview: string
  model: string
  message_count: number
  last_active: number
  started_at: number
  is_active: boolean
  source: string
  /** Original messaging platform for a completed handoff into a local chat. */
  handoff_platform?: string | null
  /** Handoff lifecycle; only `completed` should display an origin badge. */
  handoff_state?: string | null
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

export interface AudioSpeakResponse {
  ok: boolean
  data_url: string
  mime_type: string
  provider?: string
}

type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

// ── Module-level singleton state ───────────────────
const sessions = ref<Session[]>([])
// Projects are per-profile gateway state. Keep the mobile cache at the
// transport boundary so views can render it without recreating RPC plumbing.
const projects = ref<Project[]>([])
const activeProjectId = ref<string | null>(null)
const messages = ref<Message[]>([])
const loadingSessions = ref(false)
const loadingMore = ref(false)
const loadingMessages = ref(false)
const error = ref('')
const wsState = ref<ConnectionState>('idle')
const turnStartedAt = ref<number | null>(null)
const viewingCachedSessions = ref(false)
const viewingCachedTranscriptSessionId = ref<string | null>(null)
// Reactive activity marker for the focused turn. Desktop uses the last visible
// message flush to restore a "still thinking" hint when a provider goes quiet.
const lastStreamActivityAt = ref<number | null>(null)
const lastStreamTransportActivityAt = ref<number | null>(null)
let sessionsTotal = 0
let sessionsOffset = 0
let archivedSessionsTotal = 0
let archivedSessionsOffset = 0
// The archive toggle, a pull-to-refresh, and pagination can overlap on mobile.
// As on desktop, only the newest list request may publish gateway truth; an
// older response must not swap a freshly selected archive scope back underneath
// the user.
let sessionFetchGeneration = 0
let sessionListArchiveScope: 'exclude' | 'only' = 'exclude'
let sessionRefreshTimer: ReturnType<typeof setTimeout> | null = null
let sessionListPinnedIds = new Set<string>()
const recentlySettledSessionIds = new Map<string, number>()
export const SESSION_SETTLE_GRACE_MS = 30_000
// A message request can finish after the user has opened another session. Keep
// only the newest request authoritative so an older thread cannot replace it.
let messageFetchGeneration = 0
// Fast navigation cache only. The gateway remains authoritative and every
// selection revalidates, so another Hermes surface cannot leave us stale.
const messageCache = new Map<string, Message[]>()
const MESSAGE_CACHE_LIMIT = 12
// The history endpoint does not always persist a tool's unified diff. Keep the
// live `tool.complete` payload long enough to merge it into rehydrated history.
const liveToolDiffs = new Map<string, Map<string, string>>()
// Blocking clarify requests are gateway state, not transcript text. Keep them
// keyed by stored session id so the prompt survives a route change and can be
// answered after returning to the conversation.
const clarifyRequests = ref<Record<string, ClarifyRequest>>({})
const runtimeToStoredSession = new Map<string, string>()

function rememberMessages(sessionId: string, incoming: Message[]) {
  messageCache.delete(sessionId)
  messageCache.set(sessionId, incoming)
  if (messageCache.size > MESSAGE_CACHE_LIMIT) {
    const oldest = messageCache.keys().next().value
    if (oldest) messageCache.delete(oldest)
  }
}

function recordLiveToolDiff(sessionId: string, toolId: string, diff: string) {
  if (!sessionId || !toolId || !diff) return
  const sessionDiffs = liveToolDiffs.get(sessionId) || new Map<string, string>()
  sessionDiffs.set(toolId, diff)
  liveToolDiffs.set(sessionId, sessionDiffs)
}

function attachLiveToolDiffs(sessionId: string, rawMessages: unknown[]): unknown[] {
  const sessionDiffs = liveToolDiffs.get(sessionId)
  if (!sessionDiffs?.size) return rawMessages

  return rawMessages.map(raw => {
    if (!raw || typeof raw !== 'object') return raw
    const record = raw as Record<string, unknown>
    const toolId = typeof record.tool_call_id === 'string' ? record.tool_call_id : typeof record.id === 'string' ? record.id : ''
    const diff = toolId ? sessionDiffs.get(toolId) : undefined
    return diff && typeof record.inline_diff !== 'string' ? { ...record, inline_diff: diff } : raw
  })
}

function storedSessionIdForRuntime(runtimeSessionId: string | null): string | null {
  if (!runtimeSessionId) return null
  if (activeTurn?.sessionId === runtimeSessionId) return activeTurn.storedSessionId
  return runtimeToStoredSession.get(runtimeSessionId) ?? runtimeSessionId
}

function clearClarifyRequest(sessionId: string, requestId: string): void {
  const current = clarifyRequests.value[sessionId]
  if (!current || current.requestId !== requestId) return
  const next = { ...clarifyRequests.value }
  delete next[sessionId]
  clarifyRequests.value = next
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
interface TurnResult {
  content: string
  interrupted: boolean
  assistantMessage: Message
}

let activeTurn: {
  sessionId: string
  storedSessionId: string
  assistantMessage: Message
  resolve: (result: TurnResult) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
} | null = null
let streamingContent = ''

function currentTranscriptMessage(message: Message): Message {
  const index = messages.value.indexOf(message)
  return index >= 0 ? messages.value[index] : message
}

function updateActiveTurnReasoning(value: unknown, replace = false): void {
  if (!activeTurn) return

  const text = extractText(value)
  if (!text) return

  const target = currentTranscriptMessage(activeTurn.assistantMessage)
  const last = messages.value[messages.value.length - 1]
  const assistant = target?.role === 'assistant' ? target : last
  if (!assistant || assistant.role !== 'assistant') return

  const next = updateStreamingReasoning(assistant, text, replace)
  if (next === assistant) return

  lastStreamActivityAt.value = Date.now()
  Object.assign(assistant, next)
  persistInFlightTurn(activeTurn.storedSessionId, messages.value)
}

// Some gateway stream frames are intentionally unscoped. Keep them attached
// to the runtime that received message.start so switching chats mid-turn cannot
// move the live response onto the newly focused transcript.
let unscopedStreamSessionId: string | null = null

// Config
let baseUrl = ''
let cookie = ''
let ticketFn: (() => Promise<string>) | null = null
let activeCacheProfile = 'default'

const activeRuntimeId = computed(() => activeTurn?.sessionId ?? null)
const activeStoredSessionId = computed(() => activeTurn?.storedSessionId ?? null)

function clearTurnActivity(): void {
  const settled = settledTurnActivity()
  turnStartedAt.value = settled.turnStartedAt
  lastStreamActivityAt.value = settled.lastStreamActivityAt
  lastStreamTransportActivityAt.value = null
}

function startTurnActivity(): void {
  const now = Date.now()
  turnStartedAt.value = now
  lastStreamActivityAt.value = now
  lastStreamTransportActivityAt.value = now
}

function currentOfflineCacheScope(url: string): string {
  return offlineCacheScopeKey(url, activeCacheProfile)
}

function sessionOfflineCacheScope(url: string, archived: 'exclude' | 'only'): string {
  return `${currentOfflineCacheScope(url)}|archived:${archived}`
}

function setActiveCacheProfile(url: string, profile: string | null | undefined): void {
  activeCacheProfile = profile?.trim() || 'default'
  offlineCache.writeLastProfile(url, activeCacheProfile)
}

function clearOfflineCache(url: string): void {
  offlineCache.clearScope(currentOfflineCacheScope(url))
  offlineCache.clearScope(sessionOfflineCacheScope(url, 'exclude'))
  offlineCache.clearScope(sessionOfflineCacheScope(url, 'only'))
  viewingCachedSessions.value = false
  viewingCachedTranscriptSessionId.value = null
}

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
  cron: 'Cron',
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
export const SESSION_PICKER_LIMIT = 200

/**
 * Match desktop's unscoped recent-session query. Source is display metadata,
 * not a filter: restricting this list to desktop sessions hides mobile, CLI,
 * and messaging conversations from the user's history.
 */
export function sessionListPath(limit: number, offset: number, archived: 'exclude' | 'only'): string {
  return `/api/sessions?limit=${limit}&offset=${offset}&min_messages=1&archived=${archived}&order=recent`
}

/** Desktop refreshes a larger recent-session window whenever its picker opens. */
export function sessionPickerPath(): string {
  return sessionListPath(SESSION_PICKER_LIMIT, 0, 'exclude')
}

/**
 * Build the same branch request Desktop sends: preserve the parent's workspace
 * while copying only conversational prose into the child session.
 */
export function branchSessionParams(
  parentSessionId: string,
  sourceMessages: readonly Pick<SessionMessage, 'role' | 'content'>[],
  cwd: string | null | undefined = '',
) {
  const parentId = parentSessionId.trim()
  const messages = branchableMessageHistory(sourceMessages)
  if (!parentId || !messages.length) {
    throw new Error('Nothing to branch')
  }

  const workspaceCwd = typeof cwd === 'string' ? cwd.trim() : ''
  return {
    cols: 96,
    source: 'desktop',
    ...(workspaceCwd ? { cwd: workspaceCwd } : {}),
    parent_session_id: parentId,
    messages,
  }
}

/** Set durable rows that must survive the gateway's recency-window refresh. */
function setSessionListKeepIds(ids: readonly string[]): void {
  sessionListPinnedIds = new Set(ids)
}

function rememberSettledSession(sessionId: string): void {
  const id = sessionId.trim()
  if (id) recentlySettledSessionIds.set(id, Date.now() + SESSION_SETTLE_GRACE_MS)
}

function currentSessionListKeepIds(now = Date.now()): Set<string> {
  for (const [id, expiresAt] of recentlySettledSessionIds) {
    if (expiresAt <= now) recentlySettledSessionIds.delete(id)
  }

  return buildSessionListKeepIds({
    pinnedIds: [...sessionListPinnedIds],
    activeSessionId: activeStoredSessionId.value,
    activeSessionRows: sessions.value,
    recentlySettledIds: [...recentlySettledSessionIds.keys()],
  })
}

async function fetchSessions(url: string, append = false, archived: 'exclude' | 'only' = 'exclude'): Promise<Session[]> {
  // A refresh can be overtaken by an archive toggle, or a Load more request by
  // a pull-to-refresh. Capture a generation before reading pagination state and
  // allow only the newest request to change the shared session cache.
  const generation = ++sessionFetchGeneration
  sessionListArchiveScope = archived
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
  const cacheScope = sessionOfflineCacheScope(url, archived)
  const cachedSessions = append ? null : offlineCache.readSessions<Session>(cacheScope)
  if (!append && cachedSessions !== null) {
    sessions.value = cachedSessions
    viewingCachedSessions.value = true
  }
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}${sessionListPath(
        PAGE_SIZE,
        append ? (archived === 'only' ? archivedSessionsOffset : sessionsOffset) : 0,
        archived,
      )}`,
      { method: 'GET', headers, credentials: 'same-origin' },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    const incoming = data.sessions || []

    // The response is cache data, not ownership of the list. A newer intent
    // (notably archive scope) wins even when this request completes later.
    if (generation !== sessionFetchGeneration) return sessions.value

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
      // The endpoint is a recent page, not the complete session archive. Keep
      // pinned rows that fell outside that page, just as the desktop sidebar
      // does, while letting the server replace all rows it did return.
      sessions.value = mergeSessionPage(sessions.value, incoming, currentSessionListKeepIds())
    }
    offlineCache.writeSessions(cacheScope, sessions.value)
    viewingCachedSessions.value = false
    return sessions.value
  } catch (err: any) {
    if (generation === sessionFetchGeneration) {
      const fallback = cachedSessions ?? offlineCache.readSessions<Session>(cacheScope)
      if (fallback !== null) {
        sessions.value = fallback
        viewingCachedSessions.value = true
        error.value = ''
        return sessions.value
      }
      error.value = err.message || 'Failed to load sessions'
    }
    return []
  } finally {
    if (generation === sessionFetchGeneration) {
      loadingSessions.value = false
      loadingMore.value = false
    }
  }
}

/**
 * Fetch the picker-sized recent window without replacing the sidebar cache.
 * Picker refresh is auxiliary: a transient failure must leave its cached rows
 * usable and must not turn the whole chat surface into an error state.
 */
async function fetchSessionPickerSessions(url: string): Promise<Session[] | null> {
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}${sessionPickerPath()}`,
      { method: 'GET', headers, credentials: 'same-origin' },
      FETCH_TIMEOUT,
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    return Array.isArray(data?.sessions) ? data.sessions : []
  } catch {
    return null
  }
}

/**
 * Keep the session list in sync with the desktop after a completed turn. The
 * list endpoint is authoritative for generated titles, previews, counts, and
 * newly-created stored sessions; a local message append cannot provide all of
 * those fields. Preserve the current archive scope and coalesce completions
 * arriving in the same short burst.
 */
function scheduleSessionRefresh(): void {
  if (!baseUrl || disposed || sessionRefreshTimer !== null) return

  sessionRefreshTimer = setTimeout(() => {
    sessionRefreshTimer = null
    void fetchSessions(baseUrl, false, sessionListArchiveScope)
  }, SESSION_REFRESH_DEBOUNCE_MS)
}

/**
 * Show a just-created chat in Sessions before its first turn completes. This is
 * a presentation cache only; the debounced post-completion refresh replaces it
 * with the gateway's generated title, preview, count, and recency.
 */
function upsertOptimisticSession(storedSessionId: string, preview: string): void {
  const optimistic = optimisticSessionForSend(storedSessionId, preview)
  sessions.value = [optimistic, ...sessions.value.filter(session => session.id !== storedSessionId)]
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

async function requestSessionMessages(url: string, sessionId: string): Promise<Message[]> {
  const base = url.replace(/\/$/, '')
  const headers: Record<string, string> = {}
  if (cookie) headers['Cookie'] = cookie
  const resp = await fetchWithTimeout(
    `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: 'GET', headers, credentials: 'same-origin' },
    MESSAGE_FETCH_TIMEOUT,
  )
  if (!resp.ok) throw new Error('HTTP ' + resp.status)
  const data = await resp.json()
  const raw = attachLiveToolDiffs(sessionId, data.messages || [])
  return recoverInFlightTurn(sessionId, normalizeSessionMessages(raw))
}

async function fetchMessages(url: string, sessionId: string): Promise<Message[]> {
  const generation = ++messageFetchGeneration
  const cached = messageCache.get(sessionId)
  const cacheScope = currentOfflineCacheScope(url)
  const persisted = offlineCache.readTranscript<Message>(cacheScope, sessionId)
  if (cached) {
    // Publish immediately, then reconcile with the authoritative response.
    messages.value = cached
    viewingCachedTranscriptSessionId.value = null
  } else if (persisted !== null) {
    messages.value = persisted
    rememberMessages(sessionId, persisted)
    viewingCachedTranscriptSessionId.value = sessionId
  }
  loadingMessages.value = true
  error.value = ''
  try {
    const incoming = await requestSessionMessages(url, sessionId)

    // Navigation may have started a newer fetch while this request was in
    // flight. Preserve the foreground thread in that case.
    if (generation !== messageFetchGeneration) return []
    rememberMessages(sessionId, incoming)
    offlineCache.writeTranscript(cacheScope, sessionId, incoming)
    viewingCachedTranscriptSessionId.value = null
    messages.value = incoming
    return incoming
  } catch (err: any) {
    if (generation === messageFetchGeneration) {
      const fallback = cached ?? persisted ?? offlineCache.readTranscript<Message>(cacheScope, sessionId)
      if (fallback !== null) {
        messages.value = fallback
        viewingCachedTranscriptSessionId.value = sessionId
        error.value = ''
        return messages.value
      }
      error.value = err.message || 'Failed to load messages'
    }
    return []
  } finally {
    if (generation === messageFetchGeneration) {
      loadingMessages.value = false
    }
  }
}

/** Fetch a session transcript for export without replacing the foreground chat. */
async function fetchMessagesForExport(url: string, sessionId: string): Promise<Message[]> {
  if (!sessionId.trim()) throw new Error('A session is required to export')
  return requestSessionMessages(url, sessionId)
}

/** Fetch a gateway-retained image as a portable data URL. */
async function fetchMediaDataUrl(url: string, path: string): Promise<string | null> {
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/media?path=${encodeURIComponent(path)}`,
      { method: 'GET', headers, credentials: 'same-origin' },
      FETCH_TIMEOUT,
    )
    if (!resp.ok) return null
    const data = await resp.json()
    return typeof data?.data_url === 'string' && /^data:image\//i.test(data.data_url) ? data.data_url : null
  } catch {
    return null
  }
}

/** Request Desktop-compatible gateway TTS audio without exposing transport in the view. */
async function speakText(url: string, text: string): Promise<AudioSpeakResponse> {
  const trimmedText = text.trim()
  if (!trimmedText) throw new Error('Text is required for read aloud')

  const base = url.replace(/\/$/, '')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (cookie) headers['Cookie'] = cookie
  const resp = await fetchWithTimeout(
    `${base}/api/audio/speak`,
    {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      body: JSON.stringify({ text: trimmedText }),
    },
    audioSpeakRequestTimeoutMs(trimmedText),
  )
  if (!resp.ok) throw new Error('HTTP ' + resp.status)

  const data = await resp.json()
  if (data?.ok !== true || typeof data?.data_url !== 'string' || !/^data:audio\//i.test(data.data_url)) {
    throw new Error('Gateway returned an invalid audio response')
  }

  return {
    ok: true,
    data_url: data.data_url,
    mime_type: typeof data.mime_type === 'string' ? data.mime_type : 'audio/mpeg',
    provider: typeof data.provider === 'string' ? data.provider : undefined,
  }
}

/** Fetch the same per-session context breakdown shown by Desktop's status bar. */
async function fetchContextUsage(_url: string, storedSessionId: string): Promise<ContextUsage | null> {
  if (!storedSessionId || !ws || wsState.value !== 'open') return null

  try {
    let runtimeId = activeTurn?.storedSessionId === storedSessionId ? activeTurn.sessionId : ''
    if (!runtimeId) {
      for (const [candidateRuntimeId, candidateStoredId] of runtimeToStoredSession) {
        if (candidateStoredId === storedSessionId) {
          runtimeId = candidateRuntimeId
          break
        }
      }
    }
    if (!runtimeId) runtimeId = await resumeSession(storedSessionId)

    const result = await rpcCall('session.context_breakdown', { session_id: runtimeId })
    return normalizeContextUsage(result)
  } catch {
    // Context usage is an optional read-only enhancement. A backend without the
    // breakdown RPC must not turn a usable transcript into a failed chat.
    return null
  }
}

// ── Persistent WebSocket ───────────────────────────

async function connectWs(url: string, sessCookie: string, getTicket: () => Promise<string>) {
  baseUrl = url
  cookie = sessCookie
  ticketFn = getTicket
  activeCacheProfile = offlineCache.readLastProfile(url)
  disposed = false
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempt = 0
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
        if (activeTurn) lastStreamTransportActivityAt.value = Date.now()

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
  const explicitSessionId = typeof event.session_id === 'string' ? event.session_id : ''
  const route = resolveGatewayEventSessionId({
    activeSessionId: activeTurn?.sessionId ?? null,
    eventType: type,
    explicitSessionId,
    unscopedStreamSessionId,
  })
  unscopedStreamSessionId = route.nextUnscopedStreamSessionId
  if (route.drop) return
  const sessionId = route.sessionId

  // Keep the completed row in the local recency window while the gateway
  // persists its new preview/count. Desktop uses the same short settle grace;
  // without it a background completion can make the row disappear on refresh.
  if (shouldRefreshSessionsForEvent(type, sessionId) && sessionId) {
    const storedSessionId = storedSessionIdForRuntime(sessionId) || sessionId
    rememberSettledSession(storedSessionId)
    scheduleSessionRefresh()
  }

  if (type === 'clarify.request') {
    const storedSessionId = storedSessionIdForRuntime(sessionId)
    const request = normalizeClarifyRequest(event.payload, storedSessionId)
    if (request) {
      clarifyRequests.value = { ...clarifyRequests.value, [request.sessionId]: request }
    }
    return
  }

  if (type === 'tool.complete' && sessionId) {
    const diff = event.payload?.inline_diff
    const toolId = event.payload?.tool_id || event.payload?.tool_call_id || event.payload?.id
    if (typeof diff === 'string' && diff.trim() && typeof toolId === 'string') {
      recordLiveToolDiff(sessionId, toolId, diff)
    }
  }

  if (type === 'message.delta' && activeTurn && sessionId === activeTurn.sessionId) {
    const delta = event.payload?.text || event.payload?.content || ''
    if (delta) {
      lastStreamActivityAt.value = Date.now()
      streamingContent += delta
      const target = currentTranscriptMessage(activeTurn.assistantMessage)
      const last = messages.value[messages.value.length - 1]
      const assistant = target?.role === 'assistant' ? target : last
      if (assistant && assistant.role === 'assistant') {
        assistant.content = streamingContent
        persistInFlightTurn(activeTurn.storedSessionId, messages.value)
      }
    }
  }

  // Desktop streams dedicated reasoning frames alongside answer deltas. Keep
  // them in the same assistant row so the existing mobile disclosure updates
  // live instead of appearing only after the next history refresh.
  if ((type === 'reasoning.delta' || type === 'reasoning.available') && activeTurn && sessionId === activeTurn.sessionId) {
    updateActiveTurnReasoning(
      event.payload?.text ?? event.payload?.content ?? event.payload?.reasoning,
      type === 'reasoning.available',
    )
  }

  // Desktop seals interim commentary before the final response starts. Without
  // this boundary, the final completion overwrites progress text that was
  // already visible during tool-heavy or verify-on-stop turns.
  if (type === 'message.interim' && activeTurn && sessionId === activeTurn.sessionId) {
    const interimText = event.payload?.text || event.payload?.content || streamingContent || ''
    const boundary = sealInterimAssistantMessage(
      messages.value,
      currentTranscriptMessage(activeTurn.assistantMessage),
      interimText,
      Date.now() / 1000,
    )
    if (boundary) {
      lastStreamActivityAt.value = Date.now()
      const activeMessageIndex = boundary.messages.indexOf(boundary.activeMessage)
      messages.value = boundary.messages
      activeTurn.assistantMessage = messages.value[activeMessageIndex] || boundary.activeMessage
      streamingContent = ''
      persistInFlightTurn(activeTurn.storedSessionId, messages.value)
    }
  }

  if (type === 'message.complete' && activeTurn && sessionId === activeTurn.sessionId) {
    const turn = activeTurn
    clearTimeout(turn.timer)
    const content = streamingContent || event.payload?.content || ''
    const failure = completionFailure(event.payload)
    const resolve = turn.resolve
    const reject = turn.reject
    const storedSessionId = turn.storedSessionId
    let assistantMessage = currentTranscriptMessage(turn.assistantMessage)

    // If the final text includes a sealed interim segment, settle the final
    // response onto that segment instead of rendering the same text twice.
    const currentIndex = messages.value.indexOf(assistantMessage)
    const previous = currentIndex > 0 ? messages.value[currentIndex - 1] : undefined
    const previousText = previous?.role === 'assistant' && previous.interim ? previous.content.trim() : ''
    const finalText = content.trim()
    const finalContinuesInterim = Boolean(
      previousText
      && finalText
      && (event.payload?.response_previewed === true
        || finalText === previousText
        || finalText.startsWith(previousText)
        || previousText.startsWith(finalText)),
    )
    if (!failure && finalContinuesInterim && previous && currentIndex > 0) {
      const settled = { ...previous, content: finalText, interim: false }
      messages.value = [
        ...messages.value.slice(0, currentIndex - 1),
        settled,
        ...messages.value.slice(currentIndex + 1),
      ]
      assistantMessage = messages.value[currentIndex - 1] || settled
    }

    activeTurn = null
    streamingContent = ''
    clearTurnActivity()
    clearInFlightTurn(storedSessionId)
    if (failure) {
      reject(new Error(failure.message))
    } else {
      resolve({ content, interrupted: false, assistantMessage })
    }
  }

  if (type === 'error' && activeTurn && sessionId === activeTurn.sessionId) {
    clearTimeout(activeTurn.timer)
    const errMsg = event.payload?.message || event.payload?.error || 'Turn failed'
    const reject = activeTurn.reject
    const storedSessionId = activeTurn.storedSessionId
    activeTurn = null
    streamingContent = ''
    clearTurnActivity()
    // An error event is terminal just like a failed message.complete. Leaving
    // its journal behind would resurrect a failed partial reply on a later
    // history refresh, even though the reader has already received the failure.
    clearInFlightTurn(storedSessionId)
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
  if (sessionRefreshTimer) {
    clearTimeout(sessionRefreshTimer)
    sessionRefreshTimer = null
  }
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
  unscopedStreamSessionId = null
  recentlySettledSessionIds.clear()
  clearTurnActivity()
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

/** Load the same explicit and auto-discovered workspaces that Desktop shows. */
async function fetchProjects(): Promise<Project[]> {
  try {
    const payload = normalizeProjectTreePayload(await rpcCall('projects.tree', { preview_limit: 0 }))
    projects.value = payload.projects
    activeProjectId.value = payload.activeId
    return projects.value
  } catch (err: any) {
    error.value = err.message || 'Failed to load projects'
    return projects.value
  }
}

/** Persist the selected project so future Hermes surfaces share the workspace. */
async function setActiveProject(projectId: string | null): Promise<boolean> {
  try {
    const result = await rpcCall('projects.set_active', { id: projectId || null })
    const returnedId = typeof result?.active_id === 'string' ? result.active_id.trim() : ''
    activeProjectId.value = projects.value.some(project => project.id === returnedId) ? returnedId : null
    return true
  } catch (err: any) {
    error.value = err.message || 'Failed to set active project'
    return false
  }
}

/** Create and select a project; its primary folder is where a new chat will run. */
async function createProject(name: string, primaryPath: string): Promise<Project | null> {
  const params = projectCreateParams(name, primaryPath)
  if (typeof params.name !== 'string' || !params.name) {
    error.value = 'A project name is required'
    return null
  }

  try {
    const result = await rpcCall('projects.create', params)
    const project = normalizeProjectsPayload({ projects: [result?.project] }).projects[0]
    if (!project) throw new Error('projects.create returned no project')

    projects.value = [project, ...projects.value.filter(item => item.id !== project.id)]
    activeProjectId.value = project.id
    // The create response is enough to paint immediately; refresh in the
    // background so any server-computed fields remain the source of truth.
    void fetchProjects()
    return project
  } catch (err: any) {
    error.value = err.message || 'Failed to create project'
    return null
  }
}

async function resumeSession(storedSessionId: string): Promise<string> {
  const result = await rpcCall('session.resume', {
    session_id: storedSessionId,
    cols: 96,
    source: 'desktop',
  })
  const runtimeId = result?.session_id
  if (!runtimeId) throw new Error('session.resume returned no session id')
  runtimeToStoredSession.set(runtimeId, storedSessionId)
  return runtimeId
}

async function createSession(cwd = ''): Promise<{ runtimeId: string; storedSessionId: string | null }> {
  const result = await rpcCall('session.create', projectSessionCreateParams(cwd))
  const runtimeId = result?.session_id
  if (!runtimeId) throw new Error('session.create returned no session id')
  return { runtimeId, storedSessionId: result?.stored_session_id ?? null }
}

/**
 * Create a stored child conversation without disturbing its parent. Desktop
 * seeds a branch through `session.create` and keeps only conversational prose;
 * the returned stored identity is what mobile routes and history fetches use.
 */
async function branchSession(
  parentSessionId: string,
  sourceMessages: readonly Pick<Message, 'role' | 'content'>[],
  cwd?: string | null,
): Promise<string> {
  const result = await rpcCall('session.create', branchSessionParams(parentSessionId, sourceMessages, cwd))
  const storedSessionId = result?.stored_session_id ?? result?.session_id
  if (!storedSessionId) throw new Error('session.create returned no stored session id')
  if (result?.session_id) runtimeToStoredSession.set(result.session_id, storedSessionId)
  return storedSessionId
}

/** Stage mobile-picked files using the same gateway RPCs as Desktop. */
async function attachPendingFiles(
  runtimeId: string,
  attachments: readonly PendingAttachment[],
  text: string,
): Promise<string> {
  const fileRefs: string[] = []
  let imageCount = 0

  for (const attachment of attachments) {
    if (attachment.attachedRuntimeId === runtimeId) {
      if (attachment.refText) fileRefs.push(attachment.refText)
      else imageCount++
      continue
    }

    const payload = base64FromDataUrl(attachment.dataUrl)
    if (!payload) throw new Error(`Could not read ${attachment.name}`)

    if (attachment.kind === 'image') {
      const result = await rpcCall('image.attach_bytes', {
        session_id: runtimeId,
        content_base64: payload,
        filename: attachment.name,
      })
      if (!result?.attached) {
        throw new Error(result?.message || `Could not attach ${attachment.name}`)
      }
      attachment.attachedRuntimeId = runtimeId
      imageCount++
      continue
    }

    const result = await rpcCall('file.attach', {
      name: attachment.name,
      path: '',
      session_id: runtimeId,
      data_url: attachment.dataUrl,
    })
    if (!result?.attached || typeof result.ref_text !== 'string' || !result.ref_text.trim()) {
      throw new Error(result?.message || `Could not attach ${attachment.name}`)
    }
    fileRefs.push(result.ref_text.trim())
    attachment.attachedRuntimeId = runtimeId
    attachment.refText = result.ref_text.trim()
  }

  return buildAttachmentPrompt(text, fileRefs, imageCount)
}

async function sendMessage(
  _url: string,
  sessionId: string,
  text: string,
  isNewSession: boolean = false,
  attachments: readonly PendingAttachment[] = [],
  workspaceCwd = '',
): Promise<{ message: Message; newSessionId: string | null } | null> {
  if (!ws || wsState.value !== 'open') {
    throw new Error('WebSocket not connected')
  }

  let runtimeId: string
  if (isNewSession) {
    const created = await createSession(workspaceCwd)
    runtimeId = created.runtimeId
    if (created.storedSessionId) {
      sessionId = created.storedSessionId
      upsertOptimisticSession(sessionId, text)
    }
    runtimeToStoredSession.set(runtimeId, sessionId)
  } else {
    runtimeId = await resumeSession(sessionId)
  }

  const promptText = attachments.length > 0
    ? await attachPendingFiles(runtimeId, attachments, text)
    : text

  const assistantMsg: Message = {
    role: 'assistant',
    content: '',
    timestamp: Date.now() / 1000,
  }
  messages.value.push(assistantMsg)

  streamingContent = ''
  startTurnActivity()

  const turnResult = await new Promise<TurnResult>((resolve, reject) => {
    const TURN_TIMEOUT = 1_800_000
    const timer = setTimeout(() => {
      activeTurn = null
      streamingContent = ''
      clearTurnActivity()
      reject(new Error('Turn timed out'))
    }, TURN_TIMEOUT)

    unscopedStreamSessionId = null
    activeTurn = { sessionId: runtimeId, storedSessionId: sessionId, assistantMessage: assistantMsg, resolve, reject, timer }
    persistInFlightTurn(sessionId, messages.value)

    const id = ++nextId
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'prompt.submit',
      params: { session_id: runtimeId, text: promptText },
    })).catch((err: any) => {
      clearTimeout(timer)
      activeTurn = null
      streamingContent = ''
      clearTurnActivity()
      reject(err)
    })
  })

  const responseMessage = turnResult.assistantMessage
  responseMessage.content = turnResult.content
  if (turnResult.interrupted) {
    const streamIndex = messages.value.indexOf(responseMessage)
    messages.value = finalizeInterruptedMessages(messages.value, streamIndex)
  } else if (!responseMessage.content) {
    responseMessage.content = '[empty response]'
  }
  return { message: responseMessage, newSessionId: isNewSession ? sessionId : null }
}

async function respondToClarify(
  _url: string,
  sessionId: string,
  requestId: string,
  answer: string,
): Promise<void> {
  const trimmedAnswer = answer.trim()
  if (!sessionId || !requestId || !trimmedAnswer) {
    throw new Error('A clarification answer is required')
  }

  const request = clarifyRequests.value[sessionId]
  if (!request || request.requestId !== requestId) {
    throw new Error('Clarification request is no longer active')
  }

  await rpcCall('clarify.respond', { request_id: requestId, answer: trimmedAnswer })
  clearClarifyRequest(sessionId, requestId)
}

/**
 * Stop is a terminal local transition, not merely a best-effort RPC. Desktop
 * clears stream ownership before asking the gateway to interrupt so the next
 * prompt cannot inherit the previous turn's promise or route late frames into
 * it. The send promise resolves with the partial text, allowing the view to
 * preserve it without displaying a retryable error.
 */
function settleInterruptedTurn(runtimeId: string): void {
  if (!activeTurn || activeTurn.sessionId !== runtimeId) return

  const turn = activeTurn
  const content = streamingContent
  clearTimeout(turn.timer)
  activeTurn = null
  streamingContent = ''
  unscopedStreamSessionId = null
  clearTurnActivity()
  clearInFlightTurn(turn.storedSessionId)
  turn.resolve({ content, interrupted: true, assistantMessage: currentTranscriptMessage(turn.assistantMessage) })
}

async function interruptSession(sessionId: string): Promise<void> {
  settleInterruptedTurn(sessionId)
  try {
    await rpcCall('session.interrupt', { session_id: sessionId })
  } catch {
    // Best-effort
  }
}

/**
 * Send a Desktop-style correction into the active runtime. If the volatile
 * runtime id was lost during reconnect, rebind the stored session once before
 * retrying rather than silently turning a correction into a new conversation.
 */
async function redirectSession(storedSessionId: string, text: string): Promise<SessionRedirectResult> {
  const targetStoredId = storedSessionId.trim()
  const trimmedText = text.trim()
  if (!targetStoredId || !trimmedText) throw new Error('A steering message is required')
  if (!ws || wsState.value !== 'open') throw new Error('WebSocket not connected')

  let runtimeId = activeTurn?.storedSessionId === targetStoredId ? activeTurn.sessionId : ''
  if (!runtimeId) {
    for (const [candidateRuntimeId, candidateStoredId] of runtimeToStoredSession) {
      if (candidateStoredId === targetStoredId) {
        runtimeId = candidateRuntimeId
        break
      }
    }
  }
  if (!runtimeId) throw new Error('No active turn to steer')

  const sendRedirect = async (candidateRuntimeId: string): Promise<SessionRedirectResult> => {
    const result = sessionRedirectResult(await rpcCall('session.redirect', sessionRedirectParams(candidateRuntimeId, trimmedText)))
    if (!result) throw new Error('Gateway rejected the steering request')
    return result
  }

  try {
    return await sendRedirect(runtimeId)
  } catch (err) {
    if (!isSessionNotFoundError(err)) throw err

    const recoveredRuntimeId = await resumeSession(targetStoredId)
    if (activeTurn?.storedSessionId === targetStoredId) {
      activeTurn.sessionId = recoveredRuntimeId
    }
    return sendRedirect(recoveredRuntimeId)
  }
}

async function interruptBeforeRewind(runtimeId: string): Promise<void> {
  if (shouldInterruptBeforeRewind(activeTurn?.sessionId ?? null, runtimeId)) {
    await interruptSession(runtimeId)
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

  // The local rewind is optimistic. Preserve a snapshot so an unavailable
  // runtime or rejected submit cannot strand the reader in a truncated chat.
  const originalMessages = messages.value
  try {
    const runtimeId = await resumeSession(sessionId)

    // Mirror desktop's optimistic reload: retain the prompt while replacing only
    // the response branch. The gateway truncates and re-submits this same turn.
    messages.value = rewindToMessage(originalMessages, lastUserEntry.idx)

    await interruptBeforeRewind(runtimeId)

  const assistantMsg: Message = {
    role: 'assistant',
    content: '',
    timestamp: Date.now() / 1000,
  }
  messages.value.push(assistantMsg)

  streamingContent = ''
  startTurnActivity()

  const turnResult = await new Promise<TurnResult>((resolve, reject) => {
    const TURN_TIMEOUT = 1_800_000
    const timer = setTimeout(() => {
      activeTurn = null
      streamingContent = ''
      clearTurnActivity()
      reject(new Error('Turn timed out'))
    }, TURN_TIMEOUT)

    unscopedStreamSessionId = null
    activeTurn = { sessionId: runtimeId, storedSessionId: sessionId, assistantMessage: assistantMsg, resolve, reject, timer }
    persistInFlightTurn(sessionId, messages.value)

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
      clearTurnActivity()
      reject(err)
    })
  })

  const responseMessage = turnResult.assistantMessage
  responseMessage.content = turnResult.content
  if (turnResult.interrupted) {
    messages.value = finalizeInterruptedMessages(messages.value, messages.value.indexOf(responseMessage))
  } else if (!responseMessage.content) {
    responseMessage.content = '[empty response]'
  }
  return responseMessage
  } catch (err) {
    messages.value = originalMessages
    throw err
  }
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

  const originalMessages = messages.value
  try {
    const runtimeId = await resumeSession(sessionId)
    messages.value = rewindToMessage(originalMessages, msgIndex)

    await interruptBeforeRewind(runtimeId)

  const assistantMsg: Message = {
    role: 'assistant',
    content: '',
    timestamp: Date.now() / 1000,
  }
  messages.value.push(assistantMsg)

  streamingContent = ''
  startTurnActivity()

  const turnResult = await new Promise<TurnResult>((resolve, reject) => {
    const TURN_TIMEOUT = 1_800_000
    const timer = setTimeout(() => {
      activeTurn = null
      streamingContent = ''
      clearTurnActivity()
      reject(new Error('Turn timed out'))
    }, TURN_TIMEOUT)

    unscopedStreamSessionId = null
    activeTurn = { sessionId: runtimeId, storedSessionId: sessionId, assistantMessage: assistantMsg, resolve, reject, timer }
    persistInFlightTurn(sessionId, messages.value)

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
      clearTurnActivity()
      reject(err)
    })
  })

  const responseMessage = turnResult.assistantMessage
  responseMessage.content = turnResult.content
  if (turnResult.interrupted) {
    messages.value = finalizeInterruptedMessages(messages.value, messages.value.indexOf(responseMessage))
  } else if (!responseMessage.content) {
    responseMessage.content = '[empty response]'
  }
  return responseMessage
  } catch (err) {
    messages.value = originalMessages
    throw err
  }
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
  const userOrdinal = userOrdinalAtMessageIndex(messages.value, msgIndex)
  if (!msg || userOrdinal === null) {
    throw new Error('No user message at that index')
  }

  // An edit is a destructive rewind. Keep an immutable snapshot so a rejected
  // resume/submit restores the exact prior transcript rather than leaving a
  // locally truncated thread that no longer matches the gateway.
  const originalMessages = messages.value

  try {
    const runtimeId = await resumeSession(sessionId)

    // Mirror desktop's applyRewindOptimistic: the edited user turn replaces
    // the original and its complete old response branch disappears before the
    // replacement response starts streaming.
    messages.value = applyEditedUserTurn(originalMessages, msgIndex, newText)

    await interruptBeforeRewind(runtimeId)

    const assistantMsg: Message = {
      role: 'assistant',
      content: '',
      timestamp: Date.now() / 1000,
    }
    messages.value.push(assistantMsg)

    streamingContent = ''
    startTurnActivity()

    const turnResult = await new Promise<TurnResult>((resolve, reject) => {
      const TURN_TIMEOUT = 1_800_000
      const timer = setTimeout(() => {
        activeTurn = null
        streamingContent = ''
        clearTurnActivity()
        reject(new Error('Turn timed out'))
      }, TURN_TIMEOUT)

      unscopedStreamSessionId = null
      activeTurn = { sessionId: runtimeId, storedSessionId: sessionId, assistantMessage: assistantMsg, resolve, reject, timer }
      persistInFlightTurn(sessionId, messages.value)

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
        clearTurnActivity()
        reject(err)
      })
    })

    const responseMessage = turnResult.assistantMessage
    responseMessage.content = turnResult.content
    if (turnResult.interrupted) {
      messages.value = finalizeInterruptedMessages(messages.value, messages.value.indexOf(responseMessage))
    } else if (!responseMessage.content) {
      responseMessage.content = '[empty response]'
    }
    return responseMessage
  } catch (err) {
    messages.value = originalMessages
    throw err
  }
}

async function renameSession(sessionId: string, title: string): Promise<boolean> {
  const nextTitle = title.trim()
  const runtimeId = runtimeIdForStoredSession(sessionId, activeTurn, runtimeToStoredSession)

  // Desktop uses session.title for active/runtime-only rows. A freshly branched
  // session may not have a persisted state.db row yet, so REST PATCH would 404
  // even though the gateway can rename and persist the live session directly.
  if (nextTitle && runtimeId && wsState.value === 'open') {
    try {
      const result = await rpcCall('session.title', { session_id: runtimeId, title: nextTitle })
      const session = sessions.value.find(item => item.id === sessionId)
      if (session) session.title = typeof result?.title === 'string' ? result.title : nextTitle
      return true
    } catch {
      // The runtime may have expired during reconnect. Fall through to REST for
      // persisted sessions; its error remains authoritative if that also fails.
    }
  }

  try {
    const base = baseUrl.replace(/\/$/, '')
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', headers, credentials: 'same-origin', body: JSON.stringify({ title: nextTitle }) },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const s = sessions.value.find(s => s.id === sessionId)
    if (s) s.title = nextTitle
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

export interface GatewayProfile {
  name: string
  model?: string
  provider?: string
  is_default?: boolean
}

async function fetchProfiles(url: string): Promise<GatewayProfile[]> {
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/profiles`,
      { method: 'GET', headers, credentials: 'same-origin' },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    const data = await resp.json()
    const profiles = Array.isArray(data?.profiles) ? data.profiles : Array.isArray(data) ? data : []
    const activeProfile = profiles.find((profile: GatewayProfile) => profile?.is_default === true)
    if (typeof activeProfile?.name === 'string') setActiveCacheProfile(url, activeProfile.name)
    return profiles
  } catch (err: any) {
    error.value = err.message || 'Failed to load profiles'
    return []
  }
}

async function activateProfile(url: string, profile: string): Promise<boolean> {
  try {
    const base = url.replace(/\/$/, '')
    const headers: Record<string, string> = {}
    if (cookie) headers['Cookie'] = cookie
    const resp = await fetchWithTimeout(
      `${base}/api/profiles/${encodeURIComponent(profile)}/activate`,
      { method: 'POST', headers, credentials: 'same-origin' },
      FETCH_TIMEOUT
    )
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    setActiveCacheProfile(url, profile)
    return true
  } catch (err: any) {
    error.value = err.message || 'Failed to set active profile'
    return false
  }
}

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
    projects,
    activeProjectId,
    messages,
    clarifyRequests,
    loading,
    loadingSessions,
    loadingMessages,
    loadingMore,
    error,
    wsState,
    turnStartedAt,
    viewingCachedSessions,
    viewingCachedTranscriptSessionId,
    lastStreamActivityAt,
    lastStreamTransportActivityAt,
    activeRuntimeId,
    activeStoredSessionId,
    extractText,
    relativeTime,
    modelShort,
    formatTime,
    sourceLabel,
    fetchProjects,
    setActiveProject,
    createProject,
    setSessionListKeepIds,
    clearOfflineCache,
    fetchSessions,
    fetchSessionPickerSessions,
    searchSessions,
    hasMoreSessions,
    hasMoreArchivedSessions,
    fetchMessages,
    fetchMessagesForExport,
    fetchMediaDataUrl,
    speakText,
    fetchContextUsage,
    deleteSession,
    archiveSession,
    unarchiveSession,
    renameSession,
    connectWs,
    disconnectWs,
    createSession,
    branchSession,
    sendMessage,
    respondToClarify,
    interruptSession,
    redirectSession,
    regenerateLastMessage,
    restoreMessage,
    editMessage,
    fetchProfiles,
    activateProfile,
    fetchModels,
    setModel,
  }
}

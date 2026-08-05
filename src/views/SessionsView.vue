<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Session, SessionSearchResult } from '../composables/useGateway'
import { useAuth } from '../composables/useAuth'
import { useGateway } from '../composables/useGateway'
import { usePins } from '../composables/usePins'
import { useUnreads } from '../composables/useUnreads'
import { useLastSession } from '../composables/useLastSession'
import { useToast } from '../composables/useToast'
import { isCurrentSessionSearchGeneration, sessionMatchesSearch } from '../utils/sessionSearch'
import { excludePinnedSessions, flattenSessionsWithBranches, orderSessionsByIds, sessionIsPinned, sessionMatchesStoredId, sessionPinId, type SessionBranchEntry } from '../utils/sessionList'
import { filterSessionsBySource } from '../utils/sessionSource'
import { sessionActivityState, type SessionActivityState } from '../utils/sessionActivity'
import { isStreamStalled, nextStreamActivityDeadline, STREAM_STALL_THRESHOLD_MS } from '../utils/streamStall'
import { writeClipboardText } from '../utils/clipboard'
import { createSessionExport, deliverSessionExport } from '../utils/sessionExport'
import { sessionListTitle, sessionPreview } from '../utils/sessionTitle'
import { Archive, ArchiveRestore, Atom, Check, ChevronDown, ChevronUp, CircleX, Copy, Download, GitFork, Inbox, MoreHorizontal, Pencil, Pin, Plus, RefreshCw, Search, Trash2 } from '@lucide/vue'

const router = useRouter()
const auth = useAuth()
const gw = useGateway()
const pins = usePins()
const unreads = useUnreads()
const lastSession = useLastSession()
const toast = useToast()

const search = ref('')
// Keep the gateway request unscoped, but present the Desktop sessions first.
// Other conversation origins, including Cron, remain available from the source
// selector when needed.
const sourceFilter = ref('desktop')
const refreshing = ref(false)
const pullStart = ref(0)
const pullDelta = ref(0)
const listEl = ref<HTMLElement | null>(null)
const deletingId = ref('')
const branchingId = ref('')
const exportingId = ref('')
const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const contextMenuSessionId = ref('')
const contextMenuVisible = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })
const movingPinnedId = ref('')
const pinnedIds = ref<string[]>([])
const unreadIds = ref<Set<string>>(new Set())
const showingArchived = ref(false)
const serverSearchResults = ref<SessionSearchResult[]>([])
const searchPending = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchGeneration = 0
let unreadRefreshGeneration = 0
const sessionStatusNow = ref(Date.now())
let sessionStatusTimer: ReturnType<typeof setTimeout> | null = null

// Refresh only at a visible or transport inactivity deadline. A fresh WebSocket
// frame keeps the row in its ordinary working state rather than showing a stall.
function resetSessionStatusTimer() {
  if (sessionStatusTimer) {
    clearTimeout(sessionStatusTimer)
    sessionStatusTimer = null
  }

  const now = Date.now()
  sessionStatusNow.value = now
  const deadline = nextStreamActivityDeadline(
    gw.turnStartedAt.value,
    gw.lastStreamActivityAt.value,
    gw.lastStreamTransportActivityAt.value,
    now,
  )
  if (deadline === null) return
  sessionStatusTimer = setTimeout(resetSessionStatusTimer, Math.max(0, deadline - now))
}

watch(
  () => [gw.turnStartedAt.value, gw.lastStreamActivityAt.value, gw.lastStreamTransportActivityAt.value],
  resetSessionStatusTimer,
  { immediate: true },
)

watch(pinnedIds, ids => {
  gw.setSessionListKeepIds(ids)
}, { deep: true, immediate: true })

async function refreshUnreadIndicators() {
  const generation = ++unreadRefreshGeneration
  const ids = await unreads.getUnreadIds(gw.sessions.value)
  if (generation === unreadRefreshGeneration) {
    unreadIds.value = ids
  }
}

// ── Rename dialog ──
const renameVisible = ref(false)
const renameSessionId = ref('')
const renameTitle = ref('')
const renameInputEl = ref<HTMLInputElement | null>(null)
const renaming = ref(false)

function openRename() {
  const id = contextMenuSessionId.value
  const session = gw.sessions.value.find(s => s.id === id)
  renameTitle.value = session?.title || session?.preview || ''
  renameSessionId.value = id
  renameVisible.value = true
  closeContextMenu()
  nextTick(() => {
    renameInputEl.value?.focus()
    renameInputEl.value?.select()
  })
}

async function confirmRename() {
  const title = renameTitle.value.trim()
  if (!title || !renameSessionId.value || renaming.value) return
  renaming.value = true
  try {
    await gw.renameSession(renameSessionId.value, title)
  } catch {
    // Error handled by gateway
  } finally {
    renaming.value = false
    renameVisible.value = false
  }
}

function cancelRename() {
  renameVisible.value = false
  renameSessionId.value = ''
  renameTitle.value = ''
}

function handleRenameKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    confirmRename()
  } else if (e.key === 'Escape') {
    cancelRename()
  }
}

const menuStyle = computed(() => {
  const maxX = typeof window !== 'undefined' ? window.innerWidth : 400
  const maxY = typeof window !== 'undefined' ? window.innerHeight : 800
  return {
    left: Math.min(contextMenuPos.value.x, maxX - 180) + 'px',
    top: Math.max(0, Math.min(contextMenuPos.value.y, maxY - 380)) + 'px',
  }
})

// Date grouping
interface DateGroup {
  label: string
  sessions: SessionBranchEntry<Session>[]
}

type SessionListRow =
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'session'; key: string; entry: SessionBranchEntry<Session> }

// Keep the mobile list responsive once a gateway has accumulated a substantial
// history. This mirrors desktop's VirtualSessionList: date dividers and cards
// share one measured scroll space, while only the visible rows are mounted.
const VIRTUALIZE_THRESHOLD = 25
const VIRTUAL_OVERSCAN = 8
const DEFAULT_CARD_HEIGHT = 112
const DEFAULT_DIVIDER_HEIGHT = 32
const virtualScrollTop = ref(0)
const virtualViewportHeight = ref(600)
const measuredRowHeights = ref<Record<string, number>>({})
let virtualResizeObserver: ResizeObserver | null = null

function getDateGroups(entries: SessionBranchEntry<Session>[]): DateGroup[] {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  const startOfWeek = new Date(startOfToday)
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())

  const groups: DateGroup[] = [
    { label: 'Today', sessions: [] },
    { label: 'Yesterday', sessions: [] },
    { label: 'This week', sessions: [] },
    { label: 'Earlier', sessions: [] },
  ]

  let parentGroup: DateGroup | null = null
  for (const entry of entries) {
    // Flattening keeps descendants directly after their parent. Preserve that
    // cluster across date boundaries rather than splitting a branch away.
    if (entry.branchStem && parentGroup) {
      parentGroup.sessions.push(entry)
      continue
    }

    const session = entry.session
    const sessionDate = new Date(session.last_active * 1000)
    if (sessionDate >= startOfToday) {
      parentGroup = groups[0]
    } else if (sessionDate >= startOfYesterday) {
      parentGroup = groups[1]
    } else if (sessionDate >= startOfWeek) {
      parentGroup = groups[2]
    } else {
      parentGroup = groups[3]
    }
    parentGroup.sessions.push(entry)
  }

  return groups.filter(group => group.sessions.length > 0)
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return filterSessionsBySource(gw.sessions.value, sourceFilter.value)

  const results = new Map<string, Session>()
  for (const session of gw.sessions.value) {
    if (sessionMatchesSearch(session, q)) {
      results.set(session.id, session)
    }
  }

  if (!showingArchived.value) {
    for (const result of serverSearchResults.value) {
      if (!results.has(result.session_id)) {
        const timestamp = result.session_started || 0
        results.set(result.session_id, {
          id: result.session_id,
          _lineage_root_id: result.lineage_root || null,
          title: null,
          preview: result.snippet?.trim() || 'Matched conversation',
          model: result.model || '',
          message_count: 0,
          last_active: timestamp,
          started_at: timestamp,
          is_active: false,
          source: result.source || '',
        })
      }
    }
  }

  return filterSessionsBySource([...results.values()], sourceFilter.value)
})

const sourceOptions = computed(() => {
  const known = new Set(['desktop', 'cron'])
  for (const session of gw.sessions.value) {
    if (session.source) known.add(session.source)
  }
  for (const result of serverSearchResults.value) {
    if (result.source) known.add(result.source)
  }
  return [...known].sort((a, b) => a.localeCompare(b))
})

const pinnedSessions = computed(() =>
  orderSessionsByIds(filtered.value, pinnedIds.value)
)

const unpinnedSessions = computed(() =>
  excludePinnedSessions(filtered.value, pinnedIds.value)
)

const groupedSessions = computed(() => {
  if (search.value) {
    return [{ label: 'Search results', sessions: flattenSessionsWithBranches(filtered.value) }]
  }
  const groups = getDateGroups(flattenSessionsWithBranches(unpinnedSessions.value))
  if (pinnedSessions.value.length > 0) {
    groups.unshift({ label: 'Pinned', sessions: flattenSessionsWithBranches(pinnedSessions.value) })
  }
  return groups
})

const sessionRows = computed<SessionListRow[]>(() =>
  groupedSessions.value.flatMap(group => [
    { kind: 'divider' as const, key: `divider:${group.label}`, label: group.label },
    ...group.sessions.map(entry => ({ kind: 'session' as const, key: entry.session.id, entry })),
  ])
)

const useVirtualSessions = computed(() => sessionRows.value.length >= VIRTUALIZE_THRESHOLD)

function rowHeight(row: SessionListRow): number {
  return measuredRowHeights.value[row.key] || (row.kind === 'divider' ? DEFAULT_DIVIDER_HEIGHT : DEFAULT_CARD_HEIGHT)
}

const virtualLayout = computed(() => {
  const rows = sessionRows.value
  const offsets: number[] = []
  let total = 0
  for (const row of rows) {
    offsets.push(total)
    total += rowHeight(row)
  }
  return { offsets, total }
})

const virtualRange = computed(() => {
  const rows = sessionRows.value
  const { offsets, total } = virtualLayout.value
  if (!rows.length) return { start: 0, end: 0, top: 0, bottom: 0 }

  const before = Math.max(0, virtualScrollTop.value - DEFAULT_CARD_HEIGHT * VIRTUAL_OVERSCAN)
  const after = virtualScrollTop.value + virtualViewportHeight.value + DEFAULT_CARD_HEIGHT * VIRTUAL_OVERSCAN
  let start = 0
  while (start < rows.length && offsets[start] + rowHeight(rows[start]) < before) start++
  let end = start
  while (end < rows.length && offsets[end] < after) end++

  return {
    start,
    end,
    top: offsets[start] || 0,
    bottom: Math.max(0, total - (offsets[end] || total)),
  }
})

const visibleSessionRows = computed(() =>
  sessionRows.value.slice(virtualRange.value.start, virtualRange.value.end)
)

function refreshVirtualViewport() {
  const el = listEl.value
  if (!el) return
  virtualScrollTop.value = el.scrollTop
  virtualViewportHeight.value = el.clientHeight || 600
}

function onListScroll() {
  refreshVirtualViewport()
}

function observeVirtualRow(key: string, el: Element | { $el: Element } | null) {
  const target = el instanceof Element ? el : el?.$el
  if (!target || !virtualResizeObserver) return
  virtualResizeObserver.observe(target)
  const height = Math.ceil(target.getBoundingClientRect().height) + (target instanceof HTMLElement && target.dataset.sessionCard ? 8 : 0)
  if (height > 0 && measuredRowHeights.value[key] !== height) {
    measuredRowHeights.value = { ...measuredRowHeights.value, [key]: height }
  }
}

const hostShort = computed(() => {
  try {
    return new URL(auth.gatewayUrl.value).hostname
  } catch {
    return auth.gatewayUrl.value
  }
})

// Load pinned IDs on mount; also refresh sessions if empty (e.g. direct nav)
onMounted(async () => {
  if (typeof ResizeObserver !== 'undefined') {
    virtualResizeObserver = new ResizeObserver(entries => {
      let nextHeights: Record<string, number> | null = null
      for (const entry of entries) {
        const key = (entry.target as HTMLElement).dataset.virtualKey
        const height = Math.ceil(entry.contentRect.height) + ((entry.target as HTMLElement).dataset.sessionCard ? 8 : 0)
        if (key && height > 0 && measuredRowHeights.value[key] !== height) {
          nextHeights ??= { ...measuredRowHeights.value }
          nextHeights[key] = height
        }
      }
      if (nextHeights) measuredRowHeights.value = nextHeights
    })
  }
  await nextTick()
  refreshVirtualViewport()
  pinnedIds.value = await pins.getPinnedIds()
  if (gw.sessions.value.length === 0 && auth.isConnected.value) {
    await gw.fetchSessions(auth.gatewayUrl.value, false, showingArchived.value ? 'only' : 'exclude')
    pinnedIds.value = await pins.getPinnedIds()
  }
  await refreshUnreadIndicators()
})

// A background completion refreshes the shared session cache while this view is
// already mounted. Recompute unread dots from the new authoritative counts so
// the list reflects work completed in another Hermes surface without a manual
// refresh or route change.
watch(
  () => gw.sessions.value.map(session => `${session.id}:${session.message_count}`).join('\u0000'),
  () => { void refreshUnreadIndicators() },
)

// Match loaded sessions immediately, then ask the gateway's full-text index for
// conversations beyond the current page. A generation guard prevents a late
// response for an earlier query from replacing the current results.
watch(search, query => {
  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }

  const q = query.trim()
  const generation = ++searchGeneration
  serverSearchResults.value = []
  if (!q) {
    searchPending.value = false
    return
  }

  searchPending.value = true
  searchTimer = setTimeout(async () => {
    try {
      const results = await gw.searchSessions(auth.gatewayUrl.value, q)
      if (isCurrentSessionSearchGeneration(generation, searchGeneration)) {
        serverSearchResults.value = results
      }
    } finally {
      // Desktop clears its pending state even when the full-text index is
      // unavailable. Loaded rows remain searchable; only the spinner settles.
      if (isCurrentSessionSearchGeneration(generation, searchGeneration)) {
        searchPending.value = false
      }
    }
  }, 200)
})

watch(sessionRows, async () => {
  await nextTick()
  refreshVirtualViewport()
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (sessionStatusTimer) clearTimeout(sessionStatusTimer)
  virtualResizeObserver?.disconnect()
  virtualResizeObserver = null
})

function handleRefresh() {
  refreshing.value = true
  gw.fetchSessions(auth.gatewayUrl.value, false, showingArchived.value ? 'only' : 'exclude').then(async () => {
    pinnedIds.value = await pins.getPinnedIds()
    unreadIds.value = await unreads.getUnreadIds(gw.sessions.value)
  })
  setTimeout(() => { refreshing.value = false }, 800)
}

function loadMore() {
  gw.fetchSessions(auth.gatewayUrl.value, true, showingArchived.value ? 'only' : 'exclude').then(async () => {
    pinnedIds.value = await pins.getPinnedIds()
  })
}

function toggleArchived() {
  showingArchived.value = !showingArchived.value
  gw.sessions.value = []
  if (auth.isConnected.value) {
    gw.fetchSessions(auth.gatewayUrl.value, false, showingArchived.value ? 'only' : 'exclude').then(async () => {
      pinnedIds.value = await pins.getPinnedIds()
    })
  }
}

function confirmDelete(e: Event, id: string) {
  e.stopPropagation()
  if (deletingId.value === id) {
    const pinIds = pinIdsForSession(id)
    gw.deleteSession(auth.gatewayUrl.value, id).then(async deleted => {
      if (deleted) {
        await lastSession.clearLastSessionId(auth.gatewayUrl.value, id)
      }
      await clearPinnedIds(pinIds)
    })
    deletingId.value = ''
  } else {
    deletingId.value = id
    setTimeout(() => { if (deletingId.value === id) deletingId.value = '' }, 3000)
  }
}

// ── Long press context menu ──
function findSession(id: string): Session | undefined {
  return gw.sessions.value.find(session => session.id === id) || filtered.value.find(session => session.id === id)
}

function pinIdsForSession(id: string): string[] {
  const session = findSession(id)
  if (!session) return [id]
  return [...new Set([sessionPinId(session), session.id])]
}

async function clearPinnedIds(ids: readonly string[]) {
  for (const pinId of ids) {
    if (!pinnedIds.value.includes(pinId)) continue
    await pins.unpinSession(pinId)
    await pins.setSessionPinnedRemote(pinId, false, auth.gatewayUrl.value, auth.sessionCookie.value)
  }
  pinnedIds.value = await pins.getPinnedIds()
}

function isPinned(id: string): boolean {
  const session = findSession(id)
  return session ? sessionIsPinned(session, pinnedIds.value) : pinnedIds.value.includes(id)
}

function canMovePinnedSession(id: string, direction: 'up' | 'down'): boolean {
  const targetIds = new Set(pinIdsForSession(id))
  let firstIndex = -1
  let lastIndex = -1
  for (let index = 0; index < pinnedIds.value.length; index++) {
    if (targetIds.has(pinnedIds.value[index])) {
      if (firstIndex < 0) firstIndex = index
      lastIndex = index
    }
  }
  if (firstIndex < 0) return false

  if (direction === 'up') {
    return pinnedIds.value.slice(0, firstIndex).some(pinId => !targetIds.has(pinId))
  }
  return pinnedIds.value.slice(lastIndex + 1).some(pinId => !targetIds.has(pinId))
}

async function movePinnedSession(direction: 'up' | 'down') {
  const id = contextMenuSessionId.value
  if (!id || movingPinnedId.value || !canMovePinnedSession(id, direction)) return

  movingPinnedId.value = id
  try {
    const next = await pins.movePinnedSession(pinIdsForSession(id), direction)
    if (!next) {
      toast.show('Unable to reorder pinned sessions', 'error')
      return
    }
    pinnedIds.value = next
    closeContextMenu()
  } finally {
    movingPinnedId.value = ''
  }
}

function handleTouchStart(e: TouchEvent, sessionId: string) {
  const touch = e.touches[0]
  longPressTimer.value = setTimeout(() => {
    openContextMenu(sessionId, touch.clientX, touch.clientY)
    longPressTimer.value = null
  }, 500)
}

function handleTouchMove() {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }
}

function handleTouchEnd() {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }
}

function openContextMenu(sessionId: string, x: number, y: number) {
  contextMenuSessionId.value = sessionId
  contextMenuPos.value = { x, y }
  contextMenuVisible.value = true
}

function handleContextMenu(e: MouseEvent, sessionId: string) {
  e.preventDefault()
  openContextMenu(sessionId, e.clientX, e.clientY)
}

function openSessionActions(e: MouseEvent, sessionId: string) {
  e.stopPropagation()
  openContextMenu(sessionId, e.clientX, e.clientY)
}

function closeContextMenu() {
  contextMenuVisible.value = false
  contextMenuSessionId.value = ''
}

// Mirror desktop's session identity action. IDs are often needed to reference a
// conversation in another Hermes surface, so copy the durable stored ID rather
// than a title or transient runtime identifier.
async function copySessionId() {
  const id = contextMenuSessionId.value
  closeContextMenu()
  const copied = await writeClipboardText(id)
  toast.show(copied ? 'Session ID copied' : 'Unable to copy session ID', copied ? 'success' : 'error')
}

async function exportSessionFromList() {
  const id = contextMenuSessionId.value
  const session = findSession(id) || null
  closeContextMenu()
  if (!id || exportingId.value) return

  exportingId.value = id
  try {
    const messages = await gw.fetchMessagesForExport(auth.gatewayUrl.value, id)
    if (!messages.length) {
      toast.show('No messages to export', 'info')
      return
    }

    const title = session ? sessionListTitle(session) : 'Hermes Chat'
    const artifact = createSessionExport({
      sessionId: id,
      title,
      session,
      messages,
    })
    const delivery = await deliverSessionExport(artifact, title)
    if (delivery === 'file') {
      toast.show('Session export ready to share', 'success')
    } else if (delivery === 'text') {
      toast.show('Session JSON ready to share', 'success')
    } else if (delivery === 'clipboard') {
      toast.show('Session JSON copied to clipboard', 'success')
    } else if (delivery === 'unavailable') {
      toast.show('Export not available on this device', 'error')
    }
  } catch (err: any) {
    toast.show(err?.message || 'Export failed', 'error')
  } finally {
    exportingId.value = ''
  }
}

async function handlePin() {
  const id = contextMenuSessionId.value
  const session = findSession(id)
  const pinIds = pinIdsForSession(id)
  const durableId = session ? sessionPinId(session) : id
  if (session ? sessionIsPinned(session, pinnedIds.value) : pinnedIds.value.includes(id)) {
    await clearPinnedIds(pinIds)
  } else {
    await pins.pinSession(durableId)
    await pins.setSessionPinnedRemote(durableId, true, auth.gatewayUrl.value, auth.sessionCookie.value)
    pinnedIds.value = await pins.getPinnedIds()
  }
  closeContextMenu()
}

async function handleDelete() {
  const id = contextMenuSessionId.value
  const pinIds = pinIdsForSession(id)
  closeContextMenu()
  const deleted = await gw.deleteSession(auth.gatewayUrl.value, id)
  if (deleted) {
    await lastSession.clearLastSessionId(auth.gatewayUrl.value, id)
  }
  await clearPinnedIds(pinIds)
}

// Match Desktop's session-row action: branch the complete conversation into a
// new child session without altering the parent. Search results can be stubs,
// so hydrate the authoritative transcript before creating the branch.
async function handleBranch() {
  const id = contextMenuSessionId.value
  const session = findSession(id)
  closeContextMenu()
  if (!id || branchingId.value) return

  branchingId.value = id
  try {
    const history = await gw.fetchMessages(auth.gatewayUrl.value, id)
    if (!history.length) throw new Error('This session has no messages to branch')
    const branchId = await gw.branchSession(id, history, session?.cwd)
    await lastSession.setLastSessionId(auth.gatewayUrl.value, branchId)
    await router.push({ name: 'chat', params: { id: branchId } })
  } catch (err: any) {
    toast.show(err?.message || 'Unable to branch session', 'error')
  } finally {
    branchingId.value = ''
  }
}

async function handleArchive() {
  const id = contextMenuSessionId.value
  const pinIds = pinIdsForSession(id)
  closeContextMenu()
  await gw.archiveSession(auth.gatewayUrl.value, id)
  await clearPinnedIds(pinIds)
}

async function handleUnarchive() {
  const id = contextMenuSessionId.value
  closeContextMenu()
  await gw.unarchiveSession(auth.gatewayUrl.value, id)
}

function openSession(id: string) {
  const session = gw.sessions.value.find(s => s.id === id)
  if (session) {
    unreads.markSessionRead(id, session.message_count, session._lineage_root_id)
    unreadIds.value = new Set([...unreadIds.value].filter(uid => uid !== id))
  }
  void lastSession.setLastSessionId(auth.gatewayUrl.value, id)
  router.push({ name: 'chat', params: { id } })
}

function createNewSession() {
  router.push({ name: 'chat' })
}

async function handleMarkAllRead() {
  await unreads.markAllRead(gw.sessions.value)
  unreadIds.value = new Set()
}

// Pull-to-refresh
function onTouchStart(e: TouchEvent) {
  if (listEl.value && listEl.value.scrollTop === 0) {
    pullStart.value = e.touches[0].clientY
  }
}

function onTouchMove(e: TouchEvent) {
  if (pullStart.value === 0) return
  const delta = e.touches[0].clientY - pullStart.value
  if (delta > 0 && listEl.value && listEl.value.scrollTop === 0) {
    pullDelta.value = Math.min(delta * 0.5, 80)
  }
}

function onTouchEnd() {
  if (pullDelta.value > 50) {
    handleRefresh()
  }
  pullStart.value = 0
  pullDelta.value = 0
}

function formatCount(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function sessionStatus(session: Session): SessionActivityState {
  const hasClarifyRequest = Object.values(gw.clarifyRequests.value).some(request =>
    sessionMatchesStoredId(session, request.sessionId),
  )
  const isCurrentTurn = sessionMatchesStoredId(session, gw.activeStoredSessionId.value)
  return sessionActivityState({
    isActive: session.is_active,
    isCurrentTurn,
    isStalled: isCurrentTurn && isStreamStalled(
      gw.turnStartedAt.value,
      gw.lastStreamActivityAt.value,
      sessionStatusNow.value,
      STREAM_STALL_THRESHOLD_MS,
      gw.lastStreamTransportActivityAt.value,
    ),
    isUnread: unreadIds.value.has(session.id),
    needsInput: hasClarifyRequest,
  })
}

function sessionStatusClass(session: Session): string {
  const state = sessionStatus(session)
  if (state === 'needs-input') return 'size-2 shrink-0 rounded-full bg-app-accent shadow-[0_0_7px_rgba(94,106,210,0.6)]'
  if (state === 'working') return 'size-2 shrink-0 animate-pulse rounded-full bg-app-accent shadow-[0_0_7px_rgba(94,106,210,0.6)]'
  if (state === 'stalled') return 'size-2 shrink-0 animate-pulse rounded-full bg-app-accent/70 shadow-[0_0_7px_rgba(94,106,210,0.4)]'
  if (state === 'background') return 'size-2 shrink-0 animate-pulse rounded-full bg-app-muted'
  if (state === 'unread') return 'size-2 shrink-0 rounded-full bg-app-success shadow-[0_0_6px_rgba(34,197,94,0.5)]'
  return ''
}

function sessionStatusLabel(session: Session): string {
  const state = sessionStatus(session)
  if (state === 'needs-input') return 'Waiting for your answer'
  if (state === 'working') return 'Session running'
  if (state === 'stalled') return 'Session still running — stream quiet'
  if (state === 'background') return 'Background task running'
  if (state === 'unread') return 'Finished — unread'
  return ''
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app-bg font-sans text-app-text">
    <!-- Header -->
    <div class="flex h-[68px] shrink-0 items-center gap-3 border-b border-app-border bg-app-bg px-4">
      <div class="flex min-w-0 flex-1 items-center gap-2.5">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-xl border border-app-accent/25 bg-app-accent/10 text-app-accent"><Atom :size="20" :stroke-width="1.8" /></span>
        <div class="min-w-0">
          <div class="truncate text-[17px] font-semibold tracking-[-0.03em]">Hermes</div>
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="size-1.5 shrink-0 rounded-full" :class="auth.isConnected.value ? 'bg-app-success shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-app-error shadow-[0_0_6px_rgba(239,68,68,0.4)]'" />
            <span class="truncate text-[11px] text-app-muted">{{ hostShort }}</span>
          </div>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-0.5 rounded-lg border border-app-border bg-app-surface-2/80 p-1 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]">
        <button
          class="flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-app-muted transition-colors hover:bg-app-surface-3 hover:text-app-text"
          :class="showingArchived && 'border-app-accent/30 bg-app-accent/10 text-app-accent'"
          @click="toggleArchived"
          title="Archived sessions"
        >
          <Archive :size="16" :stroke-width="2" />
        </button>
        <button v-if="unreadIds.size > 0" class="h-8 cursor-pointer whitespace-nowrap rounded-md border-0 bg-transparent px-2 text-[11px] font-medium text-app-muted transition-colors hover:bg-app-surface-3 hover:text-app-text" @click="handleMarkAllRead" title="Mark all read">
          ✓ Read
        </button>

        <button class="flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-app-accent text-xl font-medium leading-none text-white transition-colors hover:bg-app-accent-hover" @click="createNewSession" title="New session" aria-label="New session">
          <Plus :size="20" :stroke-width="2.5" />
        </button>
        <button class="flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-app-muted transition-colors hover:bg-app-surface-3 hover:text-app-text" :class="refreshing && 'animate-spin'" @click="handleRefresh" title="Refresh" aria-label="Refresh">
          <RefreshCw :size="16" :stroke-width="1.8" />
        </button>

      </div>
    </div>

    <!-- Search -->
    <div class="relative shrink-0 px-4 py-3">
      <Search class="absolute left-7 top-1/2 -translate-y-1/2 text-app-muted" :size="16" :stroke-width="2" />
      <input
        v-model="search"
        type="text"
        class="h-10 w-full rounded-[10px] border border-app-border bg-app-surface py-0 pr-[86px] pl-10 text-sm outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
        placeholder="Search sessions…"
      />
      <button v-if="search" class="absolute right-7 top-1/2 flex cursor-pointer items-center justify-center border-0 bg-transparent p-1 text-app-muted -translate-y-1/2" @click="search = ''" aria-label="Clear search"><CircleX :size="16" :stroke-width="2" /></button>
      <span v-if="searchPending" class="pointer-events-none absolute right-[52px] top-1/2 -translate-y-1/2 text-[11px] text-app-muted">Searching…</span>
    </div>

    <div class="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
      <span class="text-xs text-app-muted">Source</span>
      <select v-model="sourceFilter" class="h-8 max-w-44 cursor-pointer rounded-md border border-app-border bg-app-surface px-2 text-xs text-app-text outline-none focus:border-app-accent">
        <option value="all">All sources</option>
        <option v-for="source in sourceOptions" :key="source" :value="source">{{ gw.sourceLabel(source) }}</option>
      </select>
    </div>

    <div v-if="gw.viewingCachedSessions.value" class="mx-4 mb-3 flex shrink-0 items-center justify-between gap-3 rounded-lg border border-app-accent/30 bg-app-accent/10 px-3 py-2 text-xs text-app-muted">
      <span>Offline — showing cached sessions</span>
      <button class="shrink-0 cursor-pointer border-0 bg-transparent px-1 font-medium text-app-accent hover:text-app-accent-hover" @click="handleRefresh">Retry</button>
    </div>

    <!-- Pull indicator -->
    <div
      v-if="pullDelta > 0"
      class="flex shrink-0 items-center justify-center overflow-hidden"
      :style="{ height: pullDelta + 'px', opacity: pullDelta / 80 }"
    >
      <div class="size-6 rounded-full border-2 border-app-border border-t-app-accent" :class="refreshing && 'animate-spin'" />
    </div>

    <!-- Loading skeleton -->
    <div v-if="gw.loading.value && gw.sessions.value.length === 0" class="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <div class="flex w-full flex-col gap-3">
        <div v-for="i in 5" :key="i" class="flex flex-col gap-2 rounded-app border border-app-border bg-app-surface p-4">
          <div class="h-3.5 animate-pulse rounded bg-app-surface-2 w-[60%]" />
          <div class="h-3.5 animate-pulse rounded bg-app-surface-2 w-[90%]" />
          <div class="h-3.5 animate-pulse rounded bg-app-surface-2 w-[40%]" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="gw.error.value" class="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <span class="text-sm text-app-error">{{ gw.error.value }}</span>
      <button class="h-10 cursor-pointer rounded-lg border-0 bg-app-accent px-6 text-[15px] font-semibold text-white transition-opacity hover:opacity-90" @click="handleRefresh">Retry</button>
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="flex flex-1 flex-col items-center justify-center gap-3 p-10">
      <Inbox :size="40" :stroke-width="1.6" class="text-app-muted" />
      <span class="text-[15px] text-app-muted">{{ search ? 'No matching sessions' : showingArchived ? 'No archived sessions' : 'No sessions found' }}</span>
      <button class="h-10 cursor-pointer rounded-lg border-0 bg-app-accent px-6 text-[15px] font-semibold text-white transition-opacity hover:opacity-90" @click="createNewSession">Start a conversation</button>
    </div>

    <!-- Sessions List -->
    <div
      v-else
      ref="listEl"
      class="flex-1 overflow-y-auto overscroll-contain px-4 py-3"
      @scroll="onListScroll"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <div v-if="useVirtualSessions" class="">
        <div :style="{ height: virtualRange.top + 'px' }" aria-hidden="true" />
        <template v-for="row in visibleSessionRows" :key="row.key">
          <div
            v-if="row.kind === 'divider'"
            :ref="el => observeVirtualRow(row.key, el)"
            class="px-1 py-2 pb-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-app-muted"
            :data-virtual-key="row.key"
          >{{ row.label }}</div>
          <div
            v-else
            :ref="el => observeVirtualRow(row.key, el)"
            class="mb-2.5 cursor-pointer rounded-app border border-app-border bg-app-surface px-4 py-3.5 transition-colors hover:bg-app-surface-2"
            :class="{ 'border-app-accent/30': isPinned(row.entry.session.id), 'ml-4': !!row.entry.branchStem }"
            data-session-card="true"
            :data-virtual-key="row.key"
            @click="openSession(row.entry.session.id)"
            @touchstart="handleTouchStart($event, row.entry.session.id)"
            @touchmove="handleTouchMove"
            @touchend="handleTouchEnd"
            @contextmenu="handleContextMenu($event, row.entry.session.id)"
          >
            <div class="mb-1 flex items-center gap-1.5">
              <span v-if="row.entry.branchStem" class="font-mono text-xs tracking-[-2px] text-app-muted" aria-hidden="true">{{ row.entry.branchStem }}</span>
              <Pin v-if="isPinned(row.entry.session.id)" :size="14" :stroke-width="2" class="text-app-accent" />
              <span class="flex-1 truncate text-[15px] font-semibold tracking-[-0.02em]">{{ sessionListTitle(row.entry.session) }}</span>
              <span
                v-if="sessionStatus(row.entry.session) !== 'idle'"
                :class="sessionStatusClass(row.entry.session)"
                :title="sessionStatusLabel(row.entry.session)"
                :aria-label="sessionStatusLabel(row.entry.session)"
                role="status"
              />
              <button
                class="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-app-muted transition-colors hover:bg-app-surface-3 hover:text-app-text"
                title="Session actions"
                aria-label="Session actions"
                @click="openSessionActions($event, row.entry.session.id)"
              >
                <MoreHorizontal :size="16" :stroke-width="2" />
              </button>
              <button
                class="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-sm text-app-muted transition-colors hover:bg-app-error/10 hover:text-app-error"
                :class="deletingId === row.entry.session.id && 'bg-app-error/15 text-app-error'"
                @click="confirmDelete($event, row.entry.session.id)"
                :title="deletingId === row.entry.session.id ? 'Confirm delete' : 'Delete'"
              >
                <Check v-if="deletingId === row.entry.session.id" :size="16" :stroke-width="2.5" />
                <Trash2 v-else :size="15" :stroke-width="2" />
              </button>
            </div>
            <span class="mb-1.5 line-clamp-2 text-[13px] leading-[1.4] text-app-muted">{{ sessionPreview(row.entry.session) }}</span>
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-app-muted">{{ formatCount(row.entry.session.message_count) }} msgs</span>
              <span class="text-xs text-app-muted opacity-50">·</span>
              <span class="text-xs text-app-muted">{{ gw.relativeTime(row.entry.session.last_active) }}</span>
              <span v-if="row.entry.session.source && row.entry.session.source !== 'desktop'" class="rounded px-1.5 py-px text-[11px] text-app-success bg-app-success/10">{{ gw.sourceLabel(row.entry.session.source) }}</span>
              <span v-if="row.entry.session.model" class="ml-auto rounded px-1.5 py-px text-[11px] text-app-accent bg-app-accent/10">{{ gw.modelShort(row.entry.session.model) }}</span>
            </div>
          </div>
        </template>
        <div :style="{ height: virtualRange.bottom + 'px' }" aria-hidden="true" />
      </div>
      <template v-else v-for="group in groupedSessions" :key="group.label">
        <div class="px-1 py-2 pb-1.5 text-xs font-semibold uppercase tracking-[0.05em] text-app-muted">{{ group.label }}</div>
        <div
          v-for="entry in group.sessions"
          :key="entry.session.id"
          class="mb-2.5 cursor-pointer rounded-app border border-app-border bg-app-surface px-4 py-3.5 transition-colors hover:bg-app-surface-2"
          :class="{ 'border-app-accent/30': isPinned(entry.session.id), 'ml-4': !!entry.branchStem }"
          data-session-card="true"
          @click="openSession(entry.session.id)"
          @touchstart="handleTouchStart($event, entry.session.id)"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
          @contextmenu="handleContextMenu($event, entry.session.id)"
        >
        <div class="mb-1 flex items-center gap-1.5">
          <span v-if="entry.branchStem" class="font-mono text-xs tracking-[-2px] text-app-muted" aria-hidden="true">{{ entry.branchStem }}</span>
          <Pin v-if="isPinned(entry.session.id)" :size="14" :stroke-width="2" class="text-app-accent" />
          <span class="flex-1 truncate text-[15px] font-semibold tracking-[-0.02em]">{{ sessionListTitle(entry.session) }}</span>
          <span
            v-if="sessionStatus(entry.session) !== 'idle'"
            :class="sessionStatusClass(entry.session)"
            :title="sessionStatusLabel(entry.session)"
            :aria-label="sessionStatusLabel(entry.session)"
            role="status"
          />
          <button
            class="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-app-muted transition-colors hover:bg-app-surface-3 hover:text-app-text"
            title="Session actions"
            aria-label="Session actions"
            @click="openSessionActions($event, entry.session.id)"
          >
            <MoreHorizontal :size="16" :stroke-width="2" />
          </button>
          <button
            class="flex size-7 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-sm text-app-muted transition-colors hover:bg-app-error/10 hover:text-app-error"
            :class="deletingId === entry.session.id && 'bg-app-error/15 text-app-error'"
            @click="confirmDelete($event, entry.session.id)"
            :title="deletingId === entry.session.id ? 'Confirm delete' : 'Delete'"
          >
            <Check v-if="deletingId === entry.session.id" :size="16" :stroke-width="2.5" />
            <Trash2 v-else :size="15" :stroke-width="2" />
          </button>
        </div>
        <span class="mb-1.5 line-clamp-2 text-[13px] leading-[1.4] text-app-muted">{{ sessionPreview(entry.session) }}</span>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-app-muted">{{ formatCount(entry.session.message_count) }} msgs</span>
          <span class="text-xs text-app-muted opacity-50">·</span>
          <span class="text-xs text-app-muted">{{ gw.relativeTime(entry.session.last_active) }}</span>
          <span v-if="entry.session.source && entry.session.source !== 'desktop'" class="rounded px-1.5 py-px text-[11px] text-app-success bg-app-success/10">{{ gw.sourceLabel(entry.session.source) }}</span>
          <span v-if="entry.session.model" class="ml-auto rounded px-1.5 py-px text-[11px] text-app-accent bg-app-accent/10">{{ gw.modelShort(entry.session.model) }}</span>
          </div>
        </div>
      </template>
      <!-- Load more -->
      <div v-if="showingArchived ? gw.hasMoreArchivedSessions() : gw.hasMoreSessions()" class="flex justify-center pt-4 pb-2">
        <button
          class="flex min-w-[140px] cursor-pointer items-center justify-center rounded-lg border border-app-border bg-transparent px-5 py-2 text-[13px] text-app-muted transition-all hover:border-app-muted hover:bg-app-surface-2 hover:text-app-text disabled:cursor-default disabled:opacity-50"
          :disabled="gw.loadingMore.value"
          @click="loadMore"
        >
          <span v-if="gw.loadingMore.value" class="size-3.5 animate-spin rounded-full border-2 border-app-border border-t-app-accent" />
          <span v-else>Load more sessions</span>
        </button>
      </div>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div v-if="contextMenuVisible" class="fixed inset-0 z-[1000]" @click="closeContextMenu">
        <div
          class="fixed z-[1001] min-w-40 rounded-[10px] border border-app-border bg-app-surface p-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
          :style="menuStyle"
          @click.stop
        >
          <button class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2" @click="openRename">
            <Pencil :size="16" :stroke-width="2" /> Rename
          </button>
          <button class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2" @click="copySessionId">
            <Copy :size="16" :stroke-width="2" /> Copy session ID
          </button>
          <button class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2 disabled:cursor-default disabled:opacity-50" :disabled="branchingId === contextMenuSessionId" @click="handleBranch">
            <GitFork :size="16" :stroke-width="2" /> {{ branchingId === contextMenuSessionId ? 'Branching…' : 'Branch from here' }}
          </button>
          <button class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2 disabled:cursor-default disabled:opacity-50" :disabled="exportingId === contextMenuSessionId" @click="exportSessionFromList">
            <Download :size="16" :stroke-width="2" /> {{ exportingId === contextMenuSessionId ? 'Exporting…' : 'Export session' }}
          </button>
          <button class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2" @click="handlePin">
            <Pin :size="16" :stroke-width="2" /> {{ isPinned(contextMenuSessionId) ? 'Unpin' : 'Pin to top' }}
          </button>
          <template v-if="isPinned(contextMenuSessionId)">
            <button class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2 disabled:cursor-default disabled:opacity-40" :disabled="Boolean(movingPinnedId) || !canMovePinnedSession(contextMenuSessionId, 'up')" @click="movePinnedSession('up')">
              <ChevronUp :size="16" :stroke-width="2" /> Move up
            </button>
            <button class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2 disabled:cursor-default disabled:opacity-40" :disabled="Boolean(movingPinnedId) || !canMovePinnedSession(contextMenuSessionId, 'down')" @click="movePinnedSession('down')">
              <ChevronDown :size="16" :stroke-width="2" /> Move down
            </button>
          </template>
          <button v-if="!showingArchived" class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2" @click="handleArchive">
            <Archive :size="16" :stroke-width="2" /> Archive
          </button>
          <button v-else class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2" @click="handleUnarchive">
            <ArchiveRestore :size="16" :stroke-width="2" /> Unarchive
          </button>
          <button class="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-3.5 py-2.5 text-left text-sm text-app-text transition-colors hover:bg-app-surface-2 text-app-error hover:bg-app-error/10" @click="handleDelete">
            <Trash2 :size="16" :stroke-width="2" /> Delete
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Rename Dialog -->
    <Teleport to="body">
      <div v-if="renameVisible" class="fixed inset-0 z-[1002] flex items-center justify-center bg-black/50 p-6" @click="cancelRename">
        <div class="w-full max-w-80 rounded-app border border-app-border bg-app-surface p-5 shadow-[0_16px_48px_rgba(0,0,0,0.5)]" @click.stop>
          <div class="mb-3.5 text-[15px] font-semibold tracking-[-0.02em]">Rename session</div>
          <input
            ref="renameInputEl"
            v-model="renameTitle"
            type="text"
            class="box-border h-10 w-full rounded-lg border border-app-border bg-app-surface-2 px-3 text-sm outline-none transition-colors placeholder:text-app-muted focus:border-app-accent"
            placeholder="Session title…"
            maxlength="120"
            @keydown="handleRenameKeydown"
          />
          <div class="mt-4 flex justify-end gap-2">
            <button class="h-9 cursor-pointer rounded-lg border border-app-border bg-transparent px-4 text-[13px] font-medium text-app-muted transition-all hover:border-app-muted hover:text-app-text" @click="cancelRename">Cancel</button>
            <button class="h-9 cursor-pointer rounded-lg border-0 bg-app-accent px-4 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40" :disabled="!renameTitle.trim() || renaming" @click="confirmRename">
              {{ renaming ? 'Saving…' : 'Rename' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

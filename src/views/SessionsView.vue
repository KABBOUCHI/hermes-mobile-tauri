<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import type { Session } from '../composables/useGateway'
import { useAuth } from '../composables/useAuth'
import { useGateway } from '../composables/useGateway'
import { usePins } from '../composables/usePins'
import { useUnreads } from '../composables/useUnreads'

const router = useRouter()
const auth = useAuth()
const gw = useGateway()
const pins = usePins()
const unreads = useUnreads()

const search = ref('')
const refreshing = ref(false)
const pullStart = ref(0)
const pullDelta = ref(0)
const listEl = ref<HTMLElement | null>(null)
const deletingId = ref('')
const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const contextMenuSessionId = ref('')
const contextMenuVisible = ref(false)
const contextMenuPos = ref({ x: 0, y: 0 })
const pinnedIds = ref<string[]>([])
const unreadIds = ref<Set<string>>(new Set())
const showingArchived = ref(false)

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
    top: Math.min(contextMenuPos.value.y, maxY - 140) + 'px',
  }
})

// Date grouping
interface DateGroup {
  label: string
  sessions: Session[]
}

function getDateGroups(sessions: Session[]): DateGroup[] {
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

  for (const session of sessions) {
    const sessionDate = new Date(session.last_active * 1000)
    
    if (sessionDate >= startOfToday) {
      groups[0].sessions.push(session)
    } else if (sessionDate >= startOfYesterday) {
      groups[1].sessions.push(session)
    } else if (sessionDate >= startOfWeek) {
      groups[2].sessions.push(session)
    } else {
      groups[3].sessions.push(session)
    }
  }

  return groups.filter(group => group.sessions.length > 0)
}

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return gw.sessions.value
  return gw.sessions.value.filter(s =>
    (s.title || s.preview || '').toLowerCase().includes(q) ||
    (s.preview || '').toLowerCase().includes(q) ||
    (s.model || '').toLowerCase().includes(q)
  )
})

const pinnedSessions = computed(() =>
  filtered.value.filter(s => pinnedIds.value.includes(s.id))
)

const unpinnedSessions = computed(() =>
  filtered.value.filter(s => !pinnedIds.value.includes(s.id))
)

const groupedSessions = computed(() => {
  if (search.value) {
    return [{ label: 'Search results', sessions: filtered.value }]
  }
  const groups = getDateGroups(unpinnedSessions.value)
  if (pinnedSessions.value.length > 0) {
    groups.unshift({ label: '📌 Pinned', sessions: pinnedSessions.value })
  }
  return groups
})

const hostShort = computed(() => {
  try {
    return new URL(auth.gatewayUrl.value).hostname
  } catch {
    return auth.gatewayUrl.value
  }
})

// Load pinned IDs on mount; also refresh sessions if empty (e.g. direct nav)
onMounted(async () => {
  pinnedIds.value = await pins.getPinnedIds()
  if (gw.sessions.value.length === 0 && auth.isConnected.value) {
    await gw.fetchSessions(auth.gatewayUrl.value, false, showingArchived.value ? 'only' : 'exclude')
    pinnedIds.value = await pins.getPinnedIds()
  }
  unreadIds.value = await unreads.getUnreadIds(gw.sessions.value)
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
    gw.deleteSession(auth.gatewayUrl.value, id).then(async () => {
      if (pinnedIds.value.includes(id)) {
        await pins.unpinSession(id)
        await pins.setSessionPinnedRemote(id, false, auth.gatewayUrl.value, auth.sessionCookie.value)
        pinnedIds.value = await pins.getPinnedIds()
      }
    })
    deletingId.value = ''
  } else {
    deletingId.value = id
    setTimeout(() => { if (deletingId.value === id) deletingId.value = '' }, 3000)
  }
}

// ── Long press context menu ──
function isPinned(id: string): boolean {
  return pinnedIds.value.includes(id)
}

function handleTouchStart(e: TouchEvent, sessionId: string) {
  const touch = e.touches[0]
  longPressTimer.value = setTimeout(() => {
    contextMenuSessionId.value = sessionId
    contextMenuPos.value = { x: touch.clientX, y: touch.clientY }
    contextMenuVisible.value = true
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

function closeContextMenu() {
  contextMenuVisible.value = false
  contextMenuSessionId.value = ''
}

async function handlePin() {
  const id = contextMenuSessionId.value
  const isNowPinned = await pins.togglePin(id)
  await pins.setSessionPinnedRemote(id, isNowPinned, auth.gatewayUrl.value, auth.sessionCookie.value)
  pinnedIds.value = await pins.getPinnedIds()
  closeContextMenu()
}

async function handleDelete() {
  const id = contextMenuSessionId.value
  closeContextMenu()
  await gw.deleteSession(auth.gatewayUrl.value, id)
  if (pinnedIds.value.includes(id)) {
    await pins.unpinSession(id)
    await pins.setSessionPinnedRemote(id, false, auth.gatewayUrl.value, auth.sessionCookie.value)
    pinnedIds.value = await pins.getPinnedIds()
  }
}

async function handleArchive() {
  const id = contextMenuSessionId.value
  closeContextMenu()
  await gw.archiveSession(auth.gatewayUrl.value, id)
  if (pinnedIds.value.includes(id)) {
    await pins.unpinSession(id)
    await pins.setSessionPinnedRemote(id, false, auth.gatewayUrl.value, auth.sessionCookie.value)
    pinnedIds.value = await pins.getPinnedIds()
  }
}

async function handleUnarchive() {
  const id = contextMenuSessionId.value
  closeContextMenu()
  await gw.unarchiveSession(auth.gatewayUrl.value, id)
}

function openSession(id: string) {
  const session = gw.sessions.value.find(s => s.id === id)
  if (session) {
    unreads.markSessionRead(id, session.message_count)
    unreadIds.value = new Set([...unreadIds.value].filter(uid => uid !== id))
  }
  router.push({ name: 'chat', params: { id } })
}

function createNewSession() {
  router.push({ name: 'chat' })
}

async function handleMarkAllRead() {
  await unreads.markAllRead(gw.sessions.value)
  unreadIds.value = new Set()
}

function goToCron() {
  router.push({ name: 'cron' })
}

function disconnect() {
  gw.disconnectWs()
  auth.clearSession()
  gw.sessions.value = []
  gw.messages.value = []
  pinnedIds.value = []
  router.replace({ name: 'connect' })
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
</script>

<template>
  <div class="SessionsView">
    <!-- Header -->
    <div class="Header">
      <div class="HeaderLeft">
        <span class="Title">☤ Hermes</span>
        <div class="ConnStatus" :class="{ online: auth.isConnected.value, offline: !auth.isConnected.value }">
          <span class="ConnDot" />
          <span class="ConnLabel">{{ hostShort }}</span>
        </div>
      </div>
      <div class="HeaderActions">
        <button
          class="ArchiveToggleBtn"
          :class="{ active: showingArchived }"
          @click="toggleArchived"
          title="Archived sessions"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </button>
        <button v-if="unreadIds.size > 0" class="MarkReadBtn" @click="handleMarkAllRead" title="Mark all read">
          ✓ Read
        </button>
        <button class="CronBtn" @click="goToCron" title="Cron jobs">
          ⏰
        </button>
        <button class="NewSessionBtn" @click="createNewSession" title="New session">
          +
        </button>
        <button class="RefreshBtn" :class="{ spinning: refreshing }" @click="handleRefresh">
          ↻
        </button>
        <button class="DisconnectBtn" @click="disconnect">
          Disconnect
        </button>
      </div>
    </div>

    <!-- Search -->
    <div class="SearchWrap">
      <svg class="SearchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        v-model="search"
        type="text"
        class="SearchInput"
        placeholder="Search sessions…"
      />
      <span v-if="search" class="SearchClear" @click="search = ''">✕</span>
    </div>

    <!-- Pull indicator -->
    <div
      v-if="pullDelta > 0"
      class="PullIndicator"
      :style="{ height: pullDelta + 'px', opacity: pullDelta / 80 }"
    >
      <div class="PullSpinner" :class="{ active: refreshing }" />
    </div>

    <!-- Loading skeleton -->
    <div v-if="gw.loading.value && gw.sessions.value.length === 0" class="StateView">
      <div class="SkeletonList">
        <div v-for="i in 5" :key="i" class="SkeletonCard">
          <div class="SkeletonLine w60" />
          <div class="SkeletonLine w90" />
          <div class="SkeletonLine w40" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="gw.error.value" class="StateView">
      <span class="ErrorText">{{ gw.error.value }}</span>
      <button class="RetryBtn" @click="handleRefresh">Retry</button>
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="StateView">
      <span class="EmptyIcon">📭</span>
      <span class="StateText">{{ search ? 'No matching sessions' : showingArchived ? 'No archived sessions' : 'No sessions found' }}</span>
      <button class="NewBtn" @click="createNewSession">Start a conversation</button>
    </div>

    <!-- Sessions List -->
    <div
      v-else
      ref="listEl"
      class="SessionList"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
    >
      <template v-for="group in groupedSessions" :key="group.label">
        <div class="DateGroupLabel">{{ group.label }}</div>
        <div
          v-for="s in group.sessions"
          :key="s.id"
          class="SessionCard"
          :class="{ pinned: isPinned(s.id) }"
          @click="openSession(s.id)"
          @touchstart="handleTouchStart($event, s.id)"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
        >
          <div class="CardTop">
            <span v-if="isPinned(s.id)" class="PinIcon">📌</span>
            <span v-if="unreadIds.has(s.id)" class="UnreadDot" />
            <span class="SessionTitle">{{ s.title || s.preview || 'Untitled' }}</span>
            <span v-if="s.is_active" class="ActiveDot" />
            <button
              class="DeleteBtn"
              :class="{ confirming: deletingId === s.id }"
              @click="confirmDelete($event, s.id)"
              :title="deletingId === s.id ? 'Confirm delete' : 'Delete'"
            >
              {{ deletingId === s.id ? '✓' : '✕' }}
            </button>
          </div>
          <span class="SessionPreview">{{ s.preview || 'No messages' }}</span>
          <div class="CardMeta">
            <span class="MetaText">{{ formatCount(s.message_count) }} msgs</span>
            <span class="MetaDot">·</span>
            <span class="MetaText">{{ gw.relativeTime(s.last_active) }}</span>
            <span v-if="s.source && s.source !== 'desktop'" class="SourceBadge">{{ gw.sourceLabel(s.source) }}</span>
            <span v-if="s.model" class="ModelBadge">{{ gw.modelShort(s.model) }}</span>
          </div>
        </div>
      </template>

      <!-- Load more -->
      <div v-if="gw.hasMoreSessions()" class="LoadMoreWrap">
        <button
          class="LoadMoreBtn"
          :disabled="gw.loadingMore.value"
          @click="loadMore"
        >
          <span v-if="gw.loadingMore.value" class="LoadMoreSpinner" />
          <span v-else>Load more sessions</span>
        </button>
      </div>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div v-if="contextMenuVisible" class="ContextMenuOverlay" @click="closeContextMenu">
        <div
          class="ContextMenu"
          :style="menuStyle"
          @click.stop
        >
          <button class="ContextMenuBtn" @click="openRename">
            ✏️ Rename
          </button>
          <button class="ContextMenuBtn" @click="handlePin">
            {{ isPinned(contextMenuSessionId) ? '📌 Unpin' : '📌 Pin to top' }}
          </button>
          <button v-if="!showingArchived" class="ContextMenuBtn" @click="handleArchive">
            📦 Archive
          </button>
          <button v-else class="ContextMenuBtn" @click="handleUnarchive">
            📤 Unarchive
          </button>
          <button class="ContextMenuBtn danger" @click="handleDelete">
            ✕ Delete
          </button>
        </div>
      </div>
    </Teleport>

    <!-- Rename Dialog -->
    <Teleport to="body">
      <div v-if="renameVisible" class="RenameOverlay" @click="cancelRename">
        <div class="RenameDialog" @click.stop>
          <div class="RenameLabel">Rename session</div>
          <input
            ref="renameInputEl"
            v-model="renameTitle"
            type="text"
            class="RenameInput"
            placeholder="Session title…"
            maxlength="120"
            @keydown="handleRenameKeydown"
          />
          <div class="RenameActions">
            <button class="RenameCancel" @click="cancelRename">Cancel</button>
            <button class="RenameConfirm" :disabled="!renameTitle.trim() || renaming" @click="confirmRename">
              {{ renaming ? 'Saving…' : 'Rename' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.SessionsView {
  background-color: var(--bg);
  flex: 1;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

/* ── Header ── */
.Header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.HeaderLeft {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.Title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}

.ConnStatus {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ConnDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.online .ConnDot {
  background: var(--success);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
}

.offline .ConnDot {
  background: var(--error);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.4);
}

.ConnLabel {
  font-size: 12px;
  color: var(--text-muted);
}

.HeaderActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.NewSessionBtn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background-color: var(--accent);
  border: none;
  color: #ffffff;
  font-size: 20px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.15s;
  line-height: 1;
}

.NewSessionBtn:hover { opacity: 0.9; }

.ArchiveToggleBtn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}

.ArchiveToggleBtn:hover { background-color: var(--surface-2); color: var(--text); }
.ArchiveToggleBtn.active { color: var(--accent); border-color: rgba(94, 106, 210, 0.3); background-color: rgba(94, 106, 210, 0.1); }

.CronBtn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}

.CronBtn:hover { background-color: var(--surface-2); }

.RefreshBtn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}

.RefreshBtn:hover { background-color: var(--surface-2); }
.RefreshBtn.spinning { animation: spin 0.8s linear infinite; }

.DisconnectBtn {
  height: 36px;
  padding: 0 14px;
  border-radius: 8px;
  background-color: transparent;
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: var(--error);
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.15s;
}

.DisconnectBtn:hover { border-color: rgba(239, 76, 94, 0.4); }

/* ── Search ── */
.SearchWrap {
  position: relative;
  padding: 12px 16px;
  flex-shrink: 0;
}

.SearchIcon {
  position: absolute;
  left: 28px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.SearchInput {
  width: 100%;
  height: 40px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 36px 0 40px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}

.SearchInput:focus { border-color: var(--accent); }
.SearchInput::placeholder { color: var(--text-muted); }

.SearchClear {
  position: absolute;
  right: 28px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
}

/* ── Pull indicator ── */
.PullIndicator {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.PullSpinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
}

.PullSpinner.active { animation: spin 0.8s linear infinite; }

/* ── States ── */
.StateView {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
}

.SkeletonList {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.SkeletonCard {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.SkeletonLine {
  height: 14px;
  background: var(--surface-2);
  border-radius: 4px;
  animation: pulse 1.5s ease-in-out infinite;
}

.SkeletonLine.w60 { width: 60%; }
.SkeletonLine.w90 { width: 90%; }
.SkeletonLine.w40 { width: 40%; }

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.8; }
}

.StateText { font-size: 15px; color: var(--text-muted); }
.EmptyIcon { font-size: 40px; }
.ErrorText { font-size: 14px; color: var(--error); }

.RetryBtn, .NewBtn {
  height: 40px;
  padding: 0 24px;
  background-color: var(--accent);
  border: none;
  border-radius: 8px;
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.RetryBtn:hover, .NewBtn:hover { opacity: 0.9; }

@keyframes spin { to { transform: rotate(360deg); } }

/* ── Session list ── */
.SessionList {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 16px;
}

.LoadMoreWrap {
  display: flex;
  justify-content: center;
  padding: 16px 0 8px;
}

.LoadMoreBtn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-muted);
  font-size: 13px;
  padding: 8px 20px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 140px;
}

.LoadMoreBtn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-muted);
  background: var(--surface-2);
}

.LoadMoreBtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.LoadMoreSpinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.DateGroupLabel {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 8px 4px 6px;
}

.SessionCard {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.SessionCard:hover { background-color: var(--surface-2); }
.SessionCard.pinned { border-color: rgba(94, 106, 210, 0.3); }

.CardTop {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.PinIcon { font-size: 12px; }

.SessionTitle {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ActiveDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--success);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
  flex-shrink: 0;
}

.DeleteBtn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}

.DeleteBtn:hover { color: var(--error); background: rgba(239, 68, 68, 0.1); }
.DeleteBtn.confirming { color: var(--error); background: rgba(239, 68, 68, 0.15); }

.SessionPreview {
  font-size: 13px;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.4;
  margin-bottom: 6px;
}

.CardMeta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.MetaText {
  font-size: 12px;
  color: var(--text-muted);
}

.MetaDot {
  font-size: 12px;
  color: var(--text-muted);
  opacity: 0.5;
}

.ModelBadge {
  font-size: 11px;
  color: var(--accent);
  background-color: rgba(94, 106, 210, 0.12);
  border-radius: 4px;
  padding: 1px 6px;
  margin-left: auto;
}

.SourceBadge {
  font-size: 11px;
  color: var(--success);
  background-color: rgba(34, 197, 94, 0.1);
  border-radius: 4px;
  padding: 1px 6px;
}

/* ── Context Menu ── */
.ContextMenuOverlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.ContextMenu {
  position: fixed;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 1001;
}

.ContextMenuBtn {
  width: 100%;
  padding: 10px 14px;
  background: none;
  border: none;
  color: var(--text);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.1s;
}

.ContextMenuBtn:hover { background: var(--surface-2); }
.ContextMenuBtn.danger { color: var(--error); }
.ContextMenuBtn.danger:hover { background: rgba(239, 68, 68, 0.1); }

/* ── Rename Dialog ── */
.RenameOverlay {
  position: fixed;
  inset: 0;
  z-index: 1002;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.RenameDialog {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  width: 100%;
  max-width: 320px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
}

.RenameLabel {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 14px;
  letter-spacing: -0.02em;
}

.RenameInput {
  width: 100%;
  height: 40px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 12px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.RenameInput:focus {
  border-color: var(--accent);
}

.RenameInput::placeholder {
  color: var(--text-muted);
}

.RenameActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.RenameCancel {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.RenameCancel:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

.RenameConfirm {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  background: var(--accent);
  border: none;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.RenameConfirm:hover { opacity: 0.9; }
.RenameConfirm:disabled { opacity: 0.4; cursor: default; }

/* ── Unread indicator ── */
.UnreadDot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--accent);
  box-shadow: 0 0 6px rgba(94, 106, 210, 0.5);
  flex-shrink: 0;
}

.MarkReadBtn {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.MarkReadBtn:hover {
  color: var(--text);
  border-color: var(--text-muted);
}
</style>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Session } from '../composables/useGateway'

const props = defineProps<{
  sessions: Session[]
  loading: boolean
  error: string
  connected: boolean
  gatewayUrl: string
  relativeTime: (ts: number) => string
  modelShort: (model: string) => string
  pinnedIds: string[]
}>()

const emit = defineEmits<{
  (e: 'open', id: string): void
  (e: 'refresh'): void
  (e: 'disconnect'): void
  (e: 'new-session'): void
  (e: 'delete-session', id: string): void
  (e: 'open-cron'): void
  (e: 'toggle-pin', id: string): void
}>()

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
  if (!q) return props.sessions
  return props.sessions.filter(s =>
    (s.title || '').toLowerCase().includes(q) ||
    (s.preview || '').toLowerCase().includes(q) ||
    (s.model || '').toLowerCase().includes(q)
  )
})

const pinnedSessions = computed(() =>
  filtered.value.filter(s => props.pinnedIds.includes(s.id))
)

const unpinnedSessions = computed(() =>
  filtered.value.filter(s => !props.pinnedIds.includes(s.id))
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
    return new URL(props.gatewayUrl).hostname
  } catch {
    return props.gatewayUrl
  }
})

function handleRefresh() {
  refreshing.value = true
  emit('refresh')
  setTimeout(() => { refreshing.value = false }, 800)
}

function confirmDelete(e: Event, id: string) {
  e.stopPropagation()
  if (deletingId.value === id) {
    emit('delete-session', id)
    deletingId.value = ''
  } else {
    deletingId.value = id
    setTimeout(() => { if (deletingId.value === id) deletingId.value = '' }, 3000)
  }
}

// ── Long press context menu ──
function isPinned(id: string): boolean {
  return props.pinnedIds.includes(id)
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

function handlePin() {
  emit('toggle-pin', contextMenuSessionId.value)
  closeContextMenu()
}

function handleDelete() {
  const id = contextMenuSessionId.value
  closeContextMenu()
  emit('delete-session', id)
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
        <div class="ConnStatus" :class="{ online: connected, offline: !connected }">
          <span class="ConnDot" />
          <span class="ConnLabel">{{ hostShort }}</span>
        </div>
      </div>
      <div class="HeaderActions">
        <button class="CronBtn" @click="emit('open-cron')" title="Cron jobs">
          ⏰
        </button>
        <button class="NewSessionBtn" @click="emit('new-session')" title="New session">
          +
        </button>
        <button class="RefreshBtn" :class="{ spinning: refreshing }" @click="handleRefresh">
          ↻
        </button>
        <button class="DisconnectBtn" @click="emit('disconnect')">
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
    <div v-if="loading && sessions.length === 0" class="StateView">
      <div class="SkeletonList">
        <div v-for="i in 5" :key="i" class="SkeletonCard">
          <div class="SkeletonLine w60" />
          <div class="SkeletonLine w90" />
          <div class="SkeletonLine w40" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="StateView">
      <span class="ErrorText">{{ error }}</span>
      <button class="RetryBtn" @click="emit('refresh')">Retry</button>
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="StateView">
      <span class="EmptyIcon">📭</span>
      <span class="StateText">{{ search ? 'No matching sessions' : 'No sessions found' }}</span>
      <button class="NewBtn" @click="emit('new-session')">Start a conversation</button>
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
          @click="emit('open', s.id)"
          @touchstart="handleTouchStart($event, s.id)"
          @touchmove="handleTouchMove"
          @touchend="handleTouchEnd"
        >
          <div class="CardTop">
            <span v-if="isPinned(s.id)" class="PinIcon">📌</span>
            <span class="SessionTitle">{{ s.title || 'Untitled' }}</span>
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
            <span class="MetaText">{{ relativeTime(s.last_active) }}</span>
            <span v-if="s.model" class="ModelBadge">{{ modelShort(s.model) }}</span>
          </div>
        </div>
      </template>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div v-if="contextMenuVisible" class="ContextMenuOverlay" @click="closeContextMenu">
        <div
          class="ContextMenu"
          :style="menuStyle"
          @click.stop
        >
          <button class="ContextMenuBtn" @click="handlePin">
            {{ isPinned(contextMenuSessionId) ? '📌 Unpin' : '📌 Pin to top' }}
          </button>
          <button class="ContextMenuBtn danger" @click="handleDelete">
            ✕ Delete
          </button>
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
  pointer-events: none;
}

.SearchInput {
  width: 100%;
  height: 40px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 32px 0 36px;
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
  font-size: 12px;
  cursor: pointer;
  padding: 4px;
}

/* ── Pull to refresh ── */
.PullIndicator {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: height 0.2s;
}

.PullSpinner {
  width: 20px;
  height: 20px;
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

.StateText { font-size: 15px; color: var(--text-muted); }
.EmptyIcon { font-size: 40px; }
.ErrorText { font-size: 14px; color: var(--error); }

.RetryBtn,
.NewBtn {
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

.RetryBtn:hover,
.NewBtn:hover { opacity: 0.9; }

/* ── Skeleton loading ── */
.SkeletonList {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.SkeletonCard {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.SkeletonLine {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

.w60 { width: 60%; }
.w90 { width: 90%; }
.w40 { width: 40%; }

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Session List ── */
.SessionList {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  -webkit-overflow-scrolling: touch;
}

.SessionCard {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s, transform 0.1s;
}

.SessionCard:hover {
  border-color: var(--accent);
  background-color: var(--surface-2);
}

.SessionCard:active {
  transform: scale(0.985);
}

.SessionCard.pinned {
  border-left: 3px solid var(--accent);
}

.CardTop {
  display: flex;
  align-items: center;
  gap: 8px;
}

.PinIcon {
  font-size: 12px;
  flex-shrink: 0;
}

.SessionTitle {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ActiveDot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background-color: var(--success);
  flex-shrink: 0;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
}

.DeleteBtn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.DeleteBtn:hover {
  color: var(--error);
  border-color: rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
}

.DeleteBtn.confirming {
  color: #ffffff;
  background: var(--error);
  border-color: var(--error);
}

.SessionPreview {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.CardMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.MetaText { font-size: 12px; color: var(--text-muted); }
.MetaDot { font-size: 12px; color: var(--text-muted); }

.ModelBadge {
  font-size: 11px;
  color: var(--accent);
  background-color: rgba(94, 106, 210, 0.12);
  border-radius: 4px;
  padding: 2px 6px;
  margin-left: auto;
}

.DateGroupLabel {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 12px 4px 6px;
  margin-bottom: 4px;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>

<!-- Context menu uses global styles (Teleported to body) -->
<style>
.ContextMenuOverlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.4);
}

.ContextMenu {
  position: fixed;
  z-index: 1001;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.ContextMenuBtn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.12s;
}

.ContextMenuBtn:hover {
  background: var(--surface-2);
}

.ContextMenuBtn.danger {
  color: var(--error);
}

.ContextMenuBtn.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}
</style>

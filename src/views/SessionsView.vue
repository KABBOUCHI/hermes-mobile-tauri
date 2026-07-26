<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Session } from '../composables/useGateway'

const props = defineProps<{
  sessions: Session[]
  loading: boolean
  error: string
  relativeTime: (ts: number) => string
  modelShort: (model: string) => string
}>()

const emit = defineEmits<{
  (e: 'open', id: string): void
  (e: 'refresh'): void
  (e: 'disconnect'): void
}>()

const search = ref('')
const refreshing = ref(false)

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return props.sessions
  return props.sessions.filter(s =>
    (s.title || '').toLowerCase().includes(q) ||
    (s.preview || '').toLowerCase().includes(q) ||
    (s.model || '').toLowerCase().includes(q)
  )
})

function handleRefresh() {
  refreshing.value = true
  emit('refresh')
  setTimeout(() => { refreshing.value = false }, 800)
}
</script>

<template>
  <div class="SessionsView">
    <!-- Header -->
    <div class="Header">
      <span class="Title">☤ Hermes</span>
      <div class="HeaderActions">
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
      <input
        v-model="search"
        type="text"
        class="SearchInput"
        placeholder="Search sessions…"
      />
      <span v-if="search" class="SearchClear" @click="search = ''">✕</span>
    </div>

    <!-- Loading -->
    <div v-if="loading && sessions.length === 0" class="StateView">
      <div class="Loader" />
      <span class="StateText">Loading sessions…</span>
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
    </div>

    <!-- Sessions List -->
    <div v-else class="SessionList">
      <div
        v-for="s in filtered"
        :key="s.id"
        class="SessionCard"
        @click="emit('open', s.id)"
      >
        <div class="CardTop">
          <span class="SessionTitle">{{ s.title || 'Untitled' }}</span>
          <span v-if="s.is_active" class="ActiveDot" />
        </div>
        <span class="SessionPreview">{{ s.preview || 'No messages' }}</span>
        <div class="CardMeta">
          <span class="MetaText">{{ s.message_count }} msgs</span>
          <span class="MetaDot">·</span>
          <span class="MetaText">{{ relativeTime(s.last_active) }}</span>
          <span v-if="s.model" class="ModelBadge">{{ modelShort(s.model) }}</span>
        </div>
      </div>
    </div>
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

.Header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 16px;
  border-bottom: 1px solid var(--border);
}

.Title {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.02em;
}

.HeaderActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

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

.RefreshBtn.spinning {
  animation: spin 0.8s linear infinite;
}

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

.DisconnectBtn:hover {
  border-color: rgba(239, 68, 68, 0.4);
}

/* Search */
.SearchWrap {
  position: relative;
  padding: 12px 16px;
}

.SearchInput {
  width: 100%;
  height: 40px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0 32px 0 14px;
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

/* States */
.StateView {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  gap: 12px;
}

.StateText {
  font-size: 15px;
  color: var(--text-muted);
}

.EmptyIcon {
  font-size: 40px;
}

.ErrorText {
  font-size: 14px;
  color: var(--error);
}

.Loader {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.RetryBtn {
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

.RetryBtn:hover { opacity: 0.9; }

/* Session List */
.SessionList {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
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
  transition: border-color 0.15s, background-color 0.15s;
}

.SessionCard:hover {
  border-color: var(--accent);
  background-color: var(--surface-2);
}

.SessionCard:active {
  transform: scale(0.99);
}

.CardTop {
  display: flex;
  align-items: center;
  gap: 8px;
}

.SessionTitle {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  letter-spacing: -0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ActiveDot {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background-color: var(--success);
  flex-shrink: 0;
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

.MetaText {
  font-size: 12px;
  color: var(--text-muted);
}

.MetaDot {
  font-size: 12px;
  color: var(--text-muted);
}

.ModelBadge {
  font-size: 11px;
  color: var(--accent);
  background-color: rgba(94, 106, 210, 0.12);
  border-radius: 4px;
  padding: 2px 6px;
  margin-left: auto;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>

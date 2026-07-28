<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { renderMarkdown } from '../utils/markdown'
import { useAuth } from '../composables/useAuth'
import { useGateway, type ModelProvider } from '../composables/useGateway'

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const gw = useGateway()

const sending = ref(false)
const selectedSessionId = ref((route.params.id as string) || '')
const isNewSession = ref(!selectedSessionId.value)

// ── Model Picker ──
const modelPickerOpen = ref(false)
const modelProviders = ref<ModelProvider[]>([])
const currentModel = ref('')
const currentProvider = ref('')
const modelLoading = ref(false)
const switchingModel = ref(false)

async function loadModels() {
  modelLoading.value = true
  const opts = await gw.fetchModels(auth.gatewayUrl.value)
  modelProviders.value = opts.providers
  currentModel.value = opts.model || ''
  currentProvider.value = opts.provider || ''
  modelLoading.value = false
}

async function selectModel(provider: string, model: string) {
  if (switchingModel.value) return
  switchingModel.value = true
  try {
    const ok = await gw.setModel(auth.gatewayUrl.value, provider, model)
    if (ok) {
      currentModel.value = model
      currentProvider.value = provider
      modelPickerOpen.value = false
    }
  } finally {
    switchingModel.value = false
  }
}

const currentModelShort = computed(() => {
  if (!currentModel.value) return 'Model'
  return gw.modelShort(currentModel.value)
})

function toggleModelPicker() {
  modelPickerOpen.value = !modelPickerOpen.value
  if (modelPickerOpen.value && modelProviders.value.length === 0) {
    loadModels()
  }
}

function closeModelPicker() {
  modelPickerOpen.value = false
}

const selectedSessionTitle = computed(() => {
  if (!selectedSessionId.value) return 'New Chat'
  const s = gw.sessions.value.find(s => s.id === selectedSessionId.value)
  return s?.title || s?.preview || 'Session'
})

// Load messages when entering with an existing session
onMounted(async () => {
  if (selectedSessionId.value) {
    try {
      await gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId.value)
    } catch (err: any) {
      alert('Failed to load messages: ' + (err.message || 'Unknown error'))
    }
  }
  // Load current model for the pill
  loadModels()
})

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const copiedIdx = ref<number | null>(null)

// Watch for route changes (navigating between sessions without remount)
watch(() => route.params.id, async (newId) => {
  selectedSessionId.value = (newId as string) || ''
  isNewSession.value = !selectedSessionId.value
  gw.messages.value = []
  searchQuery.value = ''
  matchIndices.value = []
  currentMatchIdx.value = -1
  if (selectedSessionId.value) {
    try {
      await gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId.value)
    } catch (err: any) {
      alert('Failed to load messages: ' + (err.message || 'Unknown error'))
    }
  }
})

// ── Message search ──
const searchOpen = ref(false)
const searchQuery = ref('')
const searchInputEl = ref<HTMLInputElement | null>(null)
const matchIndices = ref<number[]>([])
const currentMatchIdx = ref(-1)

function toggleSearch() {
  searchOpen.value = !searchOpen.value
  if (!searchOpen.value) {
    searchQuery.value = ''
    matchIndices.value = []
    currentMatchIdx.value = -1
  } else {
    nextTick(() => searchInputEl.value?.focus())
  }
}

function computeMatches() {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) {
    matchIndices.value = []
    currentMatchIdx.value = -1
    return
  }
  const indices: number[] = []
  for (let i = 0; i < gw.messages.value.length; i++) {
    const msg = gw.messages.value[i]
    if (msg.content && msg.content.toLowerCase().includes(q)) {
      indices.push(i)
    }
  }
  matchIndices.value = indices
  currentMatchIdx.value = indices.length > 0 ? 0 : -1

  if (indices.length > 0) {
    scrollToMatch(indices[0])
  }
}

function nextMatch() {
  if (matchIndices.value.length === 0) return
  currentMatchIdx.value = (currentMatchIdx.value + 1) % matchIndices.value.length
  scrollToMatch(matchIndices.value[currentMatchIdx.value])
}

function prevMatch() {
  if (matchIndices.value.length === 0) return
  currentMatchIdx.value = (currentMatchIdx.value - 1 + matchIndices.value.length) % matchIndices.value.length
  scrollToMatch(matchIndices.value[currentMatchIdx.value])
}

function scrollToMatch(msgIndex: number) {
  nextTick(() => {
    const el = scrollEl.value
    if (!el) return
    const msgEl = el.querySelector(`[data-msg-idx="${msgIndex}"]`)
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

function highlightText(content: string, query: string): string {
  if (!query.trim() || !content) return renderMarkdown(content)
  const rendered = renderMarkdown(content)
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escapedQuery})`, 'gi')
  return rendered.replace(regex, '<mark class="search-highlight">$1</mark>')
}

function isMatch(idx: number): boolean {
  return matchIndices.value.includes(idx)
}

function currentMatchCount(): string {
  if (matchIndices.value.length === 0) return ''
  return `${currentMatchIdx.value + 1}/${matchIndices.value.length}`
}

function handleSearchKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) {
      prevMatch()
    } else {
      nextMatch()
    }
  } else if (e.key === 'Escape') {
    toggleSearch()
  }
}

function goBack() {
  router.push({ name: 'sessions' })
}

function handleSend() {
  const text = input.value.trim()
  if (!text || sending.value) return
  sendText(text)
}

function sendText(text: string) {
  sending.value = true

  // Generate session ID for new sessions
  if (!selectedSessionId.value) {
    selectedSessionId.value = crypto.randomUUID()
  }

  // Optimistic user message
  gw.messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now() / 1000,
  })

  input.value = ''
  if (inputEl.value) {
    inputEl.value.style.height = 'auto'
  }

  gw.sendMessage(auth.gatewayUrl.value, selectedSessionId.value, text, isNewSession.value)
    .then((result) => {
      if (result?.newSessionId) {
        selectedSessionId.value = result.newSessionId
        isNewSession.value = false
      }
    })
    .catch((err: any) => {
      gw.messages.value.push({
        role: 'assistant',
        content: err.message || 'Unknown error',
        timestamp: Date.now() / 1000,
        error: true,
      })
    })
    .finally(() => {
      sending.value = false
    })
}

function retryFailed(failedMsgIdx: number) {
  // Find the user message that preceded this failed assistant message
  for (let i = failedMsgIdx - 1; i >= 0; i--) {
    if (gw.messages.value[i].role === 'user') {
      const userText = gw.messages.value[i].content
      // Remove the failed assistant message
      gw.messages.value.splice(failedMsgIdx, 1)
      sendText(userText)
      return
    }
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

// ── Jump to bottom button ──
const showJumpToBottom = ref(false)

function checkScrollPosition() {
  const el = scrollEl.value
  if (!el) return
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  showJumpToBottom.value = distanceFromBottom > 200
}

function scrollToBottom() {
  const el = scrollEl.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

// Update jump-to-bottom visibility on scroll
function onScroll() {
  checkScrollPosition()
}

// Auto-scroll also hides the button
watch(() => gw.messages.value.length, async () => {
  await nextTick()
  showJumpToBottom.value = false
})

function autoResize() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 120) + 'px'
}

function render(content: string): string {
  return renderMarkdown(content)
}

function handleMessagesClick(e: Event) {
  const target = (e.target as HTMLElement).closest('.md-code-copy') as HTMLElement | null
  if (!target) return
  const codeBlock = target.closest('.md-code-wrap')
  const code = codeBlock?.querySelector('code')?.textContent || codeBlock?.querySelector('.md-code')?.textContent || ''
  if (code) {
    navigator.clipboard.writeText(code)
    target.textContent = '✓ Copied'
    setTimeout(() => { target.textContent = 'Copy' }, 1500)
  }
}

function copyContent(content: string, idx: number) {
  navigator.clipboard.writeText(content)
  copiedIdx.value = idx
  setTimeout(() => { copiedIdx.value = null }, 1500)
}

function isThinking(content: string): boolean {
  return content.includes('<think>') && !content.includes('</think>')
}

const hasMessages = computed(() => gw.messages.value.length > 0)

// ── Live elapsed timer during streaming ──
const elapsedDisplay = ref('')
let elapsedTimer: ReturnType<typeof setInterval> | null = null

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60)
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function startElapsedTimer() {
  if (elapsedTimer) return
  elapsedTimer = setInterval(() => {
    if (gw.turnStartedAt.value) {
      elapsedDisplay.value = formatElapsed(Date.now() - gw.turnStartedAt.value)
    }
  }, 1000)
  if (gw.turnStartedAt.value) {
    elapsedDisplay.value = formatElapsed(Date.now() - gw.turnStartedAt.value)
  }
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
  elapsedDisplay.value = ''
}

watch(() => gw.turnStartedAt.value, (val) => {
  if (val) {
    startElapsedTimer()
  } else {
    stopElapsedTimer()
  }
}, { immediate: true })

// Auto-scroll to bottom
watch(() => gw.messages.value.length, async () => {
  await nextTick()
  if (scrollEl.value) {
    scrollEl.value.scrollTop = scrollEl.value.scrollHeight
  }
})

// Also scroll when last message content changes (streaming)
watch(() => {
  const msgs = gw.messages.value
  if (msgs.length === 0) return ''
  return msgs[msgs.length - 1].content
}, async () => {
  await nextTick()
  if (scrollEl.value) {
    const el = scrollEl.value
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight
    }
  }
})

// ── Export Chat ─────────────────────────────────────
async function exportChat() {
  const msgs = gw.messages.value
  if (!msgs || msgs.length === 0) {
    alert('No messages to export')
    return
  }

  const title = selectedSessionTitle.value || 'Hermes Chat'
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)

  let md = `# ${title}\n`
  md += `*Exported ${dateStr}*\n\n---\n\n`

  for (const msg of msgs) {
    const role = msg.role === 'user' ? '**You**' : '**Assistant**'
    const time = msg.timestamp
      ? new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : ''
    md += `### ${role}${time ? '  ·  ' + time : ''}\n\n`
    md += `${msg.content}\n\n---\n\n`
  }

  try {
    if (navigator.share) {
      await navigator.share({ title, text: md })
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(md)
      alert('Chat copied to clipboard')
    } else {
      alert('Export not available on this device')
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(md)
        alert('Chat copied to clipboard')
      } else {
        alert('Export failed: ' + (err?.message || 'Unknown error'))
      }
    } catch {
      alert('Export failed')
    }
  }
}

// ── Regenerate ───────────────────────────────────────
async function handleRegenerate() {
  if (sending.value) return
  if (!selectedSessionId.value) return

  sending.value = true
  try {
    await gw.regenerateLastMessage(auth.gatewayUrl.value, selectedSessionId.value)
  } catch (err: any) {
    alert('Regenerate failed: ' + (err.message || 'Unknown error'))
  } finally {
    sending.value = false
  }
}

// ── Stop / Interrupt ─────────────────────────────────
async function handleStop() {
  const runtimeId = gw.activeRuntimeId.value
  if (!runtimeId) {
    sending.value = false
    return
  }
  try {
    await gw.interruptSession(runtimeId)
  } catch {
    // Best-effort
  }
  sending.value = false
}

function formatTime(ts: number): string {
  return gw.formatTime(ts)
}
</script>

<template>
  <div class="chat-view">
    <!-- Header -->
    <div class="chat-header">
      <button class="back-btn" @click="goBack">‹</button>
      <div class="chat-title">{{ selectedSessionTitle }}</div>
      <button class="model-pill" @click="toggleModelPicker" :class="{ active: modelPickerOpen }">
        <span class="model-pill-text">{{ currentModelShort }}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <button class="icon-btn" @click="toggleSearch" :class="{ active: searchOpen }">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
      <button class="icon-btn" @click="exportChat" title="Export chat">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      <button class="icon-btn" @click="() => gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId)" :disabled="gw.loadingMessages.value">
        <svg v-if="!gw.loadingMessages.value" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 4v6h6M23 20v-6h-6"/>
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
        </svg>
        <span v-else class="spinner-sm"></span>
      </button>
    </div>

    <!-- Search bar -->
    <div v-if="searchOpen" class="search-bar">
      <svg class="search-bar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        ref="searchInputEl"
        v-model="searchQuery"
        type="text"
        class="search-bar-input"
        placeholder="Search in messages…"
        @input="computeMatches"
        @keydown="handleSearchKeydown"
      />
      <span v-if="matchIndices.length > 0" class="search-count">{{ currentMatchCount() }}</span>
      <span v-else-if="searchQuery && matchIndices.length === 0" class="search-count none">0</span>
      <button class="search-nav-btn" @click="prevMatch" :disabled="matchIndices.length === 0">‹</button>
      <button class="search-nav-btn" @click="nextMatch" :disabled="matchIndices.length === 0">›</button>
      <button class="search-close-btn" @click="toggleSearch">✕</button>
    </div>

    <!-- Messages -->
    <div class="chat-messages" ref="scrollEl" @scroll="onScroll" @click="handleMessagesClick">
      <!-- Loading state (messages fetch in progress) -->
      <div v-if="!hasMessages && gw.loadingMessages.value && !gw.error.value" class="loading-state">
        <div class="Loader" />
        <span class="loading-label">Loading messages…</span>
      </div>

      <div v-else-if="!hasMessages && !gw.error.value" class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-text">Start a conversation</div>
      </div>

      <div v-if="gw.error.value && !hasMessages" class="error-banner">{{ gw.error.value }}</div>

      <div
        v-for="(msg, idx) in gw.messages.value"
        :key="idx"
        :data-msg-idx="idx"
        class="message"
        :class="[msg.role, { 'search-match': isMatch(idx), 'search-current': matchIndices[currentMatchIdx] === idx }]"
      >
        <div class="message-bubble" :class="[msg.role, { error: msg.error }]">
          <!-- Error state -->
          <div v-if="msg.error" class="error-content">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span class="error-text">{{ msg.content || 'Failed to send' }}</span>
          </div>

          <!-- Streaming thinking indicator -->
          <div v-else-if="msg.role === 'assistant' && isThinking(msg.content)" class="thinking-indicator">
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-label">Thinking…</span>
          </div>

          <!-- Rendered markdown content -->
          <div
            v-if="msg.content && !isThinking(msg.content)"
            class="md-content"
            v-html="searchQuery.trim() && isMatch(idx) ? highlightText(msg.content, searchQuery) : render(msg.content)"
          ></div>
          <div
            v-else-if="msg.content && isThinking(msg.content)"
            class="md-content"
            v-html="searchQuery.trim() && isMatch(idx) ? highlightText(msg.content, searchQuery) : render(msg.content)"
          ></div>

          <!-- Empty assistant placeholder (streaming start) -->
          <div v-if="msg.role === 'assistant' && !msg.content" class="typing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>

        <div class="message-footer" :class="msg.role">
          <span v-if="msg.timestamp" class="message-time">{{ formatTime(msg.timestamp) }}</span>
          <button
            v-if="msg.error && !sending"
            class="action-btn retry-btn"
            @click="retryFailed(idx)"
            title="Retry sending"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v6h6M23 20v-6h-6"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
            <span>Retry</span>
          </button>
          <button
            v-if="msg.role === 'assistant' && idx === gw.messages.value.length - 1 && !sending && msg.content && idx > 0 && !msg.error"
            class="action-btn regenerate-btn"
            @click="handleRegenerate"
            title="Regenerate response"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 4v6h6M23 20v-6h-6"/>
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
            </svg>
            <span>Regenerate</span>
          </button>
          <button
            v-if="msg.content && msg.role === 'assistant'"
            class="action-btn"
            @click="copyContent(msg.content, idx)"
          >
            {{ copiedIdx === idx ? '✓ Copied' : 'Copy' }}
          </button>
        </div>
      </div>

      <!-- Typing indicator -->
      <div v-if="sending && (gw.messages.value.length === 0 || gw.messages.value[gw.messages.value.length - 1].role !== 'assistant' || gw.messages.value[gw.messages.value.length - 1].content)" class="message assistant">
        <div class="message-bubble assistant typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>

    <!-- Jump to bottom button -->
    <Transition name="jump-fade">
      <button v-if="showJumpToBottom" class="jump-to-bottom" @click="scrollToBottom">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </Transition>

    <!-- Input -->
    <div class="chat-input-bar">
      <div v-if="sending && elapsedDisplay" class="elapsed-indicator">
        <span class="elapsed-dot"></span>
        <span class="elapsed-text">{{ elapsedDisplay }}</span>
      </div>
      <div v-if="sending" class="stop-bar">
        <button class="stop-btn" @click="handleStop">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
          <span>Stop generating</span>
        </button>
      </div>
      <template v-else>
        <textarea
          ref="inputEl"
          v-model="input"
          placeholder="Message…"
          rows="1"
          @keydown="handleKeydown"
          @input="autoResize"
        ></textarea>
        <button
          class="send-btn"
          :disabled="!input.trim()"
          @click="handleSend"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </button>
      </template>
    </div>

    <!-- Model Picker Dropdown -->
    <Teleport to="body">
      <div v-if="modelPickerOpen" class="ModelPickerOverlay" @click="closeModelPicker">
        <div class="ModelPicker" @click.stop>
          <div class="ModelPickerHeader">
            <span class="ModelPickerTitle">Switch model</span>
            <button class="ModelPickerClose" @click="closeModelPicker">✕</button>
          </div>
          <div v-if="modelLoading" class="ModelPickerLoading">
            <span class="spinner-sm" />
            <span>Loading models…</span>
          </div>
          <div v-else-if="modelProviders.length === 0" class="ModelPickerEmpty">
            No models available
          </div>
          <div v-else class="ModelPickerList">
            <template v-for="provider in modelProviders" :key="provider.slug">
              <div class="ModelProviderGroup">
                <div class="ModelProviderName">{{ provider.name }}</div>
                <button
                  v-for="model in provider.models"
                  :key="model"
                  class="ModelOption"
                  :class="{
                    active: model === currentModel && provider.slug === currentProvider,
                    disabled: switchingModel,
                  }"
                  :disabled="switchingModel"
                  @click="selectModel(provider.slug, model)"
                >
                  <span class="ModelOptionName">{{ gw.modelShort(model) }}</span>
                  <span v-if="model === currentModel && provider.slug === currentProvider" class="ModelOptionCheck">✓</span>
                </button>
              </div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  position: relative;
}

/* Header */
.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  min-height: 52px;
  flex-shrink: 0;
}
.back-btn {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 22px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}
.icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;
}
.icon-btn:hover {
  color: var(--text);
  background: var(--surface-2);
}
.icon-btn.active {
  color: var(--accent);
  background: rgba(94, 106, 210, 0.12);
}
.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.chat-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Search bar */
.search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.search-bar-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}
.search-bar-input {
  flex: 1;
  height: 32px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 10px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.search-bar-input:focus {
  border-color: var(--accent);
}
.search-bar-input::placeholder {
  color: var(--text-muted);
}
.search-count {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 32px;
  text-align: center;
  flex-shrink: 0;
}
.search-count.none {
  color: var(--error);
}
.search-nav-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.15s;
}
.search-nav-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-muted);
}
.search-nav-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.search-close-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: color 0.15s;
}
.search-close-btn:hover {
  color: var(--error);
}

/* Messages */
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overscroll-behavior: contain;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0.4;
}
.empty-icon { font-size: 32px; }
.empty-text { font-size: 14px; }

.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.loading-state .Loader {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.loading-label {
  font-size: 13px;
  color: var(--text-muted);
}
@keyframes spin { to { transform: rotate(360deg); } }

.error-banner {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  padding: 10px 14px;
  color: var(--error);
  font-size: 13px;
  text-align: center;
}

/* Messages */
.message { display: flex; flex-direction: column; gap: 4px; }
.message.user { align-items: flex-end; }
.message.assistant { align-items: flex-start; }

.message-bubble {
  max-width: 88%;
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.55;
  word-break: break-word;
}
.message-bubble.user {
  background: var(--accent);
  color: #fff;
  border-bottom-right-radius: 4px;
}
.message-bubble.assistant {
  background: var(--surface-2);
  color: var(--text);
  border-bottom-left-radius: 4px;
  border: 1px solid var(--border);
}

/* Error message */
.message-bubble.error {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.25);
}
.error-content {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--error);
}
.error-text {
  font-size: 13px;
  line-height: 1.4;
}
.retry-btn {
  color: var(--error) !important;
  border-color: rgba(239, 68, 68, 0.25) !important;
}
.retry-btn:hover {
  color: #fff !important;
  background: rgba(239, 68, 68, 0.15) !important;
  border-color: rgba(239, 68, 68, 0.4) !important;
}

/* Search match styling */
.message.search-match .message-bubble {
  position: relative;
}
.message.search-current .message-bubble {
  box-shadow: 0 0 0 2px var(--accent);
}

/* Markdown content inside bubbles */
.message-bubble :deep(.md-content) {
  font-size: 14px;
  line-height: 1.55;
}
.message-bubble.user :deep(.md-content) {
  color: #fff;
}

/* Search highlight */
.message-bubble :deep(.search-highlight) {
  background: rgba(94, 106, 210, 0.35);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}

/* Footer */
.message-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 4px;
}
.message-footer.user { justify-content: flex-end; }
.message-time {
  font-size: 11px;
  color: var(--text-muted);
}
.action-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
}
.action-btn:hover {
  color: var(--text);
  border-color: var(--text-muted);
}
.action-btn.regenerate-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(94, 106, 210, 0.08);
}

/* Typing dots */
.typing-dots {
  display: flex;
  gap: 4px;
  padding: 4px 0;
  align-items: center;
}
.typing-dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: bounce 1.2s infinite;
}
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

.spinner-sm {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Thinking indicator */
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
}
.thinking-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  animation: think-pulse 1.5s ease-in-out infinite;
}
.thinking-dot:nth-child(2) { animation-delay: 0.3s; }
.thinking-dot:nth-child(3) { animation-delay: 0.6s; }
.thinking-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 4px;
}
@keyframes think-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}

/* Input bar */
.chat-input-bar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 14px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  position: relative;
}
.chat-input-bar textarea {
  flex: 1;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px 12px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.4;
  resize: none;
  outline: none;
  max-height: 120px;
  transition: border-color 0.15s;
}
.chat-input-bar textarea:focus {
  border-color: var(--accent);
}
.chat-input-bar textarea::placeholder {
  color: var(--text-muted);
}
.chat-input-bar textarea:disabled {
  opacity: 0.5;
}
.send-btn {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: none;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}
.send-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

/* Stop button */
.stop-bar {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stop-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 10px;
  border: 1px solid rgba(239, 68, 68, 0.3);
  background: rgba(239, 68, 68, 0.08);
  color: var(--error);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  width: 100%;
  justify-content: center;
}

.stop-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.5);
}

.stop-btn:active {
  transform: scale(0.98);
}

/* Elapsed indicator */
.elapsed-indicator {
  position: absolute;
  left: 14px;
  bottom: 100%;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.elapsed-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  animation: think-pulse 1.5s ease-in-out infinite;
}

.elapsed-text {
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* Jump to bottom button */
.jump-to-bottom {
  position: absolute;
  bottom: 72px;
  right: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  z-index: 10;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}
.jump-to-bottom:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--surface-2);
}
.jump-to-bottom:active {
  transform: scale(0.92);
}

/* Transition */
.jump-fade-enter-active,
.jump-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.jump-fade-enter-from,
.jump-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* Model pill in header */
.model-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
  max-width: 120px;
}
.model-pill:hover,
.model-pill.active {
  color: var(--accent);
  border-color: var(--accent);
  background: rgba(94, 106, 210, 0.1);
}
.model-pill-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Model Picker Overlay */
.ModelPickerOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.ModelPicker {
  width: 100%;
  max-width: 400px;
  max-height: 70vh;
  background: var(--surface);
  border: 1px solid var(--border);
  border-bottom: none;
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.2s ease;
}
@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
.ModelPickerHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.ModelPickerTitle {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  letter-spacing: -0.02em;
}
.ModelPickerClose {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: color 0.15s;
}
.ModelPickerClose:hover {
  color: var(--error);
}
.ModelPickerLoading,
.ModelPickerEmpty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--text-muted);
  font-size: 13px;
}
.ModelPickerList {
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 8px 0;
}
.ModelProviderGroup {
  padding: 0 8px;
}
.ModelProviderGroup + .ModelProviderGroup {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.ModelProviderName {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  padding: 6px 8px 4px;
}
.ModelOption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  border: none;
  background: none;
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
  text-align: left;
}
.ModelOption:hover:not(.disabled) {
  background: var(--surface-2);
}
.ModelOption.active {
  color: var(--accent);
  background: rgba(94, 106, 210, 0.1);
}
.ModelOption.disabled {
  opacity: 0.5;
  cursor: default;
}
.ModelOptionName {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ModelOptionCheck {
  color: var(--accent);
  font-weight: 600;
  margin-left: 8px;
}
</style>

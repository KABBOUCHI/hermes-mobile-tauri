<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { renderMarkdown } from '../utils/markdown'

interface Message {
  role: string
  content: string
  timestamp: number
}

const props = defineProps<{
  messages: Message[]
  loading: boolean
  error: string
  sending: boolean
  formatTime: (ts: number) => string
  sessionTitle: string
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'send', text: string): void
  (e: 'refresh'): void
  (e: 'export'): void
  (e: 'regenerate'): void
}>()

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const copiedIdx = ref<number | null>(null)

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
  for (let i = 0; i < props.messages.length; i++) {
    const msg = props.messages[i]
    if (msg.content && msg.content.toLowerCase().includes(q)) {
      indices.push(i)
    }
  }
  matchIndices.value = indices
  currentMatchIdx.value = indices.length > 0 ? 0 : -1

  // Scroll to first match
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
  // We'll use a post-render approach: render markdown, then highlight
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

function handleSend() {
  const text = input.value.trim()
  if (!text || props.sending) return
  emit('send', text)
  input.value = ''
  if (inputEl.value) {
    inputEl.value.style.height = 'auto'
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function autoResize() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 120) + 'px'
}

function render(content: string): string {
  return renderMarkdown(content)
}

function copyContent(content: string, idx: number) {
  navigator.clipboard.writeText(content)
  copiedIdx.value = idx
  setTimeout(() => { copiedIdx.value = null }, 1500)
}

function isThinking(content: string): boolean {
  return content.includes('<think>') && !content.includes('</think>')
}

const hasMessages = computed(() => props.messages.length > 0)

// Auto-scroll to bottom
watch(() => props.messages.length, async () => {
  await nextTick()
  if (scrollEl.value) {
    scrollEl.value.scrollTop = scrollEl.value.scrollHeight
  }
})

// Also scroll when last message content changes (streaming)
watch(() => {
  const msgs = props.messages
  if (msgs.length === 0) return ''
  return msgs[msgs.length - 1].content
}, async () => {
  await nextTick()
  if (scrollEl.value) {
    const el = scrollEl.value
    // Only auto-scroll if user is near bottom (within 150px)
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) {
      el.scrollTop = el.scrollHeight
    }
  }
})
</script>

<template>
  <div class="chat-view">
    <!-- Header -->
    <div class="chat-header">
      <button class="back-btn" @click="emit('back')">‹</button>
      <div class="chat-title">{{ sessionTitle || 'New Chat' }}</div>
      <button class="icon-btn" @click="toggleSearch" :class="{ active: searchOpen }">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </button>
      <button class="icon-btn" @click="emit('export')" title="Export chat">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      </button>
      <button class="icon-btn" @click="emit('refresh')" :disabled="loading">
        <svg v-if="!loading" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
    <div class="chat-messages" ref="scrollEl">
      <div v-if="!hasMessages && !loading && !error" class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-text">Start a conversation</div>
      </div>

      <div v-if="error && !hasMessages" class="error-banner">{{ error }}</div>

      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        :data-msg-idx="idx"
        class="message"
        :class="[msg.role, { 'search-match': isMatch(idx), 'search-current': matchIndices[currentMatchIdx] === idx }]"
      >
        <div class="message-bubble" :class="msg.role">
          <!-- Streaming thinking indicator -->
          <div v-if="msg.role === 'assistant' && isThinking(msg.content)" class="thinking-indicator">
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
          <!-- Regenerate button: only on last assistant message, not while sending -->
          <button
            v-if="msg.role === 'assistant' && idx === messages.length - 1 && !sending && msg.content && idx > 0"
            class="action-btn regenerate-btn"
            @click="emit('regenerate')"
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
      <div v-if="sending && (messages.length === 0 || messages[messages.length - 1].role !== 'assistant' || messages[messages.length - 1].content)" class="message assistant">
        <div class="message-bubble assistant typing-dots">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="chat-input-bar">
      <textarea
        ref="inputEl"
        v-model="input"
        placeholder="Message…"
        rows="1"
        @keydown="handleKeydown"
        @input="autoResize"
        :disabled="sending"
      ></textarea>
      <button
        class="send-btn"
        :disabled="!input.trim() || sending"
        @click="handleSend"
      >
        <svg v-if="!sending" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
        </svg>
        <span v-else class="spinner-sm"></span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
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
</style>

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
}>()

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const copiedIdx = ref<number | null>(null)

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
      <button class="refresh-btn" @click="emit('refresh')" :disabled="loading">
        <svg v-if="!loading" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 4v6h6M23 20v-6h-6"/>
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
        </svg>
        <span v-else class="spinner-sm"></span>
      </button>
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
        class="message"
        :class="msg.role"
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
            v-html="render(msg.content)"
          ></div>
          <div
            v-else-if="msg.content && isThinking(msg.content)"
            class="md-content"
            v-html="render(msg.content)"
          ></div>

          <!-- Empty assistant placeholder (streaming start) -->
          <div v-if="msg.role === 'assistant' && !msg.content" class="typing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>

        <div class="message-footer" :class="msg.role">
          <span v-if="msg.timestamp" class="message-time">{{ formatTime(msg.timestamp) }}</span>
          <button
            v-if="msg.content && msg.role === 'assistant'"
            class="copy-btn"
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
.refresh-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
}
.refresh-btn:disabled { opacity: 0.4; }
.chat-title {
  flex: 1;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Messages */
.chat-messages {
  flex: 1;
  overflow-y: auto;
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

/* Markdown content inside bubbles */
.message-bubble :deep(.md-content) {
  font-size: 14px;
  line-height: 1.55;
}
.message-bubble.user :deep(.md-content) {
  color: #fff;
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
.copy-btn {
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-muted);
  font-size: 11px;
  padding: 1px 6px;
  cursor: pointer;
  transition: all 0.15s;
}
.copy-btn:hover {
  color: var(--text);
  border-color: var(--text-muted);
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

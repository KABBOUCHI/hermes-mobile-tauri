<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue'
import type { Message } from '../composables/useGateway'
import { renderMarkdown } from '../utils/markdown'

const props = defineProps<{
  messages: Message[]
  loading: boolean
  error: string
  sending: boolean
  formatTime: (ts: number) => string
  sessionTitle?: string
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'send', text: string): void
}>()

const input = ref('')
const listEl = ref<HTMLElement | null>(null)
const copiedIdx = ref<number | null>(null)

const canSend = computed(() => input.value.trim() && !props.sending)

function handleSend() {
  const text = input.value.trim()
  if (!text || props.sending) return
  emit('send', text)
  input.value = ''
}

function scrollToBottom() {
  nextTick(() => {
    if (listEl.value) {
      listEl.value.scrollTop = listEl.value.scrollHeight
    }
  })
}

watch(() => props.messages.length, scrollToBottom)
watch(() => props.messages[props.messages.length - 1]?.content, scrollToBottom)

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

async function copyMessage(text: string, idx: number) {
  try {
    await navigator.clipboard.writeText(text)
    copiedIdx.value = idx
    setTimeout(() => { copiedIdx.value = null }, 1500)
  } catch {}
}
</script>

<template>
  <div class="MessageView">
    <!-- Header -->
    <div class="Header">
      <button class="BackBtn" @click="emit('back')">
        <span class="BackArrow">←</span>
        <span class="BackText">Back</span>
      </button>
      <span class="HeaderTitle">{{ sessionTitle || 'Session' }}</span>
      <div class="HeaderSpacer" />
    </div>

    <!-- Loading -->
    <div v-if="loading" class="StateView">
      <div class="Loader" />
      <span class="StateText">Loading messages…</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="StateView">
      <span class="ErrorText">{{ error }}</span>
    </div>

    <!-- Empty -->
    <div v-else-if="messages.length === 0" class="StateView">
      <span class="EmptyIcon">💬</span>
      <span class="StateText">No messages yet</span>
      <span class="StateHint">Send a message to start the conversation</span>
    </div>

    <!-- Messages -->
    <div v-else ref="listEl" class="MessageList">
      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="MessageRow"
      >
        <!-- User bubble -->
        <div v-if="msg.role === 'user'" class="BubbleUser" @click="copyMessage(msg.content, idx)">
          <span class="BubbleTextUser">{{ msg.content }}</span>
          <div class="BubbleFooter">
            <span v-if="msg.timestamp" class="TimeUser">{{ formatTime(msg.timestamp) }}</span>
            <Transition name="fade">
              <span v-if="copiedIdx === idx" class="CopiedLabel">Copied</span>
            </Transition>
          </div>
        </div>

        <!-- Assistant bubble -->
        <div v-else class="BubbleAssistant">
          <div
            class="BubbleTextAssistant md-content"
            v-html="renderMarkdown(msg.content)"
            @click="copyMessage(msg.content, idx)"
          />
          <div class="BubbleFooter">
            <span v-if="msg.timestamp" class="TimeAssistant">{{ formatTime(msg.timestamp) }}</span>
            <Transition name="fade">
              <span v-if="copiedIdx === idx" class="CopiedLabel">Copied</span>
            </Transition>
          </div>
        </div>
      </div>

      <!-- Typing indicator -->
      <div v-if="sending" class="MessageRow">
        <div class="BubbleAssistant">
          <span class="TypingIndicator">
            <span /><span /><span />
          </span>
        </div>
      </div>
    </div>

    <!-- Input Bar -->
    <div class="InputBar">
      <textarea
        ref="inputEl"
        v-model="input"
        class="ChatInput"
        placeholder="Type a message…"
        :disabled="sending"
        rows="1"
        @keydown="handleKeydown"
      />
      <button
        class="SendBtn"
        :class="{ SendBtnDisabled: !canSend }"
        :disabled="!canSend"
        @click="handleSend"
      >
        <span v-if="sending" class="SendLoader" />
        <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.MessageView {
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
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.BackBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 8px;
  transition: background 0.15s;
}

.BackBtn:hover { background: var(--surface); }

.BackArrow { font-size: 18px; color: var(--accent); }
.BackText { font-size: 15px; font-weight: 500; color: var(--accent); }

.HeaderTitle {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.HeaderSpacer { width: 76px; }

/* ── States ── */
.StateView {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
}

.StateText { font-size: 15px; color: var(--text-muted); }
.StateHint { font-size: 13px; color: #44444e; }
.ErrorText { font-size: 14px; color: var(--error); }
.EmptyIcon { font-size: 36px; margin-bottom: 4px; }

.Loader {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* ── Messages ── */
.MessageList {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.MessageRow {
  display: flex;
  flex-direction: column;
}

.BubbleUser {
  align-self: flex-end;
  max-width: 78%;
  background-color: var(--accent);
  border-radius: 16px;
  border-bottom-right-radius: 4px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.BubbleUser:active { opacity: 0.85; }

.BubbleTextUser {
  font-size: 15px;
  color: #ffffff;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.BubbleAssistant {
  align-self: flex-start;
  max-width: 88%;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  border-bottom-left-radius: 4px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.BubbleAssistant:active { opacity: 0.85; }

.BubbleTextAssistant {
  font-size: 15px;
  color: var(--text);
  line-height: 1.45;
  word-break: break-word;
}

.BubbleFooter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}

.TimeUser {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
}

.TimeAssistant {
  font-size: 11px;
  color: var(--text-muted);
}

.CopiedLabel {
  font-size: 11px;
  color: var(--success);
  font-weight: 500;
}

/* ── Typing indicator ── */
.TypingIndicator {
  display: flex;
  gap: 4px;
  padding: 4px 0;
}

.TypingIndicator span {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: var(--text-muted);
  animation: typing 1.4s infinite;
}

.TypingIndicator span:nth-child(2) { animation-delay: 0.2s; }
.TypingIndicator span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
  30% { opacity: 1; transform: scale(1); }
}

/* ── Input Bar ── */
.InputBar {
  display: flex;
  align-items: flex-end;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  gap: 8px;
  flex-shrink: 0;
}

.ChatInput {
  flex: 1;
  min-height: 44px;
  max-height: 120px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 22px;
  padding: 10px 16px;
  font-size: 15px;
  color: var(--text);
  outline: none;
  resize: none;
  line-height: 1.4;
  font-family: var(--font);
  transition: border-color 0.15s;
}

.ChatInput:focus { border-color: var(--accent); }
.ChatInput::placeholder { color: var(--text-muted); }
.ChatInput:disabled { opacity: 0.6; }

.SendBtn {
  width: 44px;
  height: 44px;
  border-radius: 22px;
  background-color: var(--accent);
  border: none;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  flex-shrink: 0;
}

.SendBtn:hover:not(:disabled) { opacity: 0.9; }
.SendBtn:active:not(:disabled) { transform: scale(0.94); }
.SendBtnDisabled { opacity: 0.4; cursor: not-allowed; }

.SendLoader {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
.fade-enter-active, .fade-leave-active { transition: opacity 0.3s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>

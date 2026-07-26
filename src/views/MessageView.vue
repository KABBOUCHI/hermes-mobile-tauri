<script setup lang="ts">
import { ref, nextTick, watch, computed } from 'vue'
import type { Message } from '../composables/useGateway'

const props = defineProps<{
  messages: Message[]
  loading: boolean
  error: string
  sending: boolean
  formatTime: (ts: number) => string
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'send', text: string): void
}>()

const input = ref('')
const listEl = ref<HTMLElement | null>(null)

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

// Auto-scroll on new messages
watch(() => props.messages.length, scrollToBottom)
watch(() => props.messages[props.messages.length - 1]?.content, scrollToBottom)

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
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
      <span class="HeaderTitle">Session</span>
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
      <span class="StateText">No messages yet</span>
    </div>

    <!-- Messages -->
    <div v-else ref="listEl" class="MessageList">
      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="MessageRow"
      >
        <div v-if="msg.role === 'user'" class="BubbleUser">
          <span class="BubbleTextUser">{{ msg.content }}</span>
          <span v-if="msg.timestamp" class="TimeUser">{{ formatTime(msg.timestamp) }}</span>
        </div>

        <div v-else class="BubbleAssistant">
          <span class="BubbleTextAssistant">{{ msg.content }}</span>
          <span v-if="msg.timestamp" class="TimeAssistant">{{ formatTime(msg.timestamp) }}</span>
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
      <input
        v-model="input"
        class="ChatInput"
        type="text"
        placeholder="Type a message…"
        :disabled="sending"
        @keydown="handleKeydown"
      />
      <button
        class="SendBtn"
        :class="{ SendBtnDisabled: !canSend }"
        :disabled="!canSend"
        @click="handleSend"
      >
        <span v-if="sending" class="SendLoader" />
        <span v-else>↑</span>
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

.Header {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.BackBtn {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: 12px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s;
}

.BackBtn:hover { background: var(--surface); }

.BackArrow {
  font-size: 18px;
  color: var(--accent);
}

.BackText {
  font-size: 15px;
  font-weight: 500;
  color: var(--accent);
}

.HeaderTitle {
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  text-align: center;
  margin-right: 76px; /* balance back button width */
}

/* States */
.StateView {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
}

.StateText { font-size: 15px; color: var(--text-muted); }
.ErrorText { font-size: 14px; color: var(--error); }

.Loader {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

/* Messages */
.MessageList {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
}

.MessageRow {
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
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
}

.BubbleTextUser {
  font-size: 15px;
  color: #ffffff;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.TimeUser {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  text-align: right;
}

.BubbleAssistant {
  align-self: flex-start;
  max-width: 85%;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  border-bottom-left-radius: 4px;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.BubbleTextAssistant {
  font-size: 15px;
  color: var(--text);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

.TimeAssistant {
  font-size: 11px;
  color: var(--text-muted);
}

/* Typing indicator */
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

/* Input Bar */
.InputBar {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  gap: 8px;
}

.ChatInput {
  flex: 1;
  height: 44px;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: 22px;
  padding: 0 16px;
  font-size: 15px;
  color: var(--text);
  outline: none;
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
  font-size: 20px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.15s;
  flex-shrink: 0;
}

.SendBtn:hover:not(:disabled) { opacity: 0.9; }
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
</style>

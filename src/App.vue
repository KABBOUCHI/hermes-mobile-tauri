<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuth } from './composables/useAuth'
import { useGateway } from './composables/useGateway'
import ConnectView from './views/ConnectView.vue'
import SessionsView from './views/SessionsView.vue'
import MessageView from './views/MessageView.vue'

const auth = useAuth()
const gw = useGateway()

type View = 'loading' | 'connect' | 'sessions' | 'chat'
const view = ref<View>('loading')
const selectedSessionId = ref('')
const sending = ref(false)

// ── Boot ───────────────────────────────────────────
onMounted(async () => {
  const ok = await auth.tryAutoLogin()
  if (ok) {
    await gw.fetchSessions(auth.gatewayUrl.value, auth.buildHeaders())
    view.value = 'sessions'
  } else {
    view.value = 'connect'
  }
})

// ── Connect ────────────────────────────────────────
async function handleConnect(url: string, user: string, pass: string) {
  auth.gatewayUrl.value = url
  auth.username.value = user
  auth.password.value = pass
  await auth.connect()
  await gw.fetchSessions(url, auth.buildHeaders())
  view.value = 'sessions'
}

// ── Sessions ───────────────────────────────────────
async function refreshSessions() {
  await gw.fetchSessions(auth.gatewayUrl.value, auth.buildHeaders())
}

function openSession(id: string) {
  selectedSessionId.value = id
  view.value = 'chat'
  gw.fetchMessages(auth.gatewayUrl.value, id, auth.buildHeaders())
}

function goBack() {
  selectedSessionId.value = ''
  view.value = 'sessions'
}

function disconnect() {
  auth.clearCredentials()
  gw.sessions.value = []
  gw.messages.value = []
  selectedSessionId.value = ''
  view.value = 'connect'
}

// ── Chat ───────────────────────────────────────────
async function handleSend(text: string) {
  if (!selectedSessionId.value || sending.value) return
  sending.value = true

  // Optimistic user message
  gw.messages.value.push({
    role: 'user',
    content: text,
    timestamp: Date.now() / 1000,
  })

  try {
    await gw.sendMessage(auth.gatewayUrl.value, selectedSessionId.value, text, auth.buildHeaders())
  } catch (err: any) {
    gw.messages.value.push({
      role: 'assistant',
      content: 'Failed to send: ' + (err.message || 'Unknown error'),
      timestamp: Date.now() / 1000,
    })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="Root">
    <!-- Loading -->
    <div v-if="view === 'loading'" class="StateView">
      <div class="Loader" />
    </div>

    <!-- Connect -->
    <ConnectView
      v-else-if="view === 'connect'"
      :loading="auth.isConnected.value === false && gw.loading.value"
      :error="gw.error.value"
      @connect="handleConnect"
    />

    <!-- Sessions -->
    <SessionsView
      v-else-if="view === 'sessions'"
      :sessions="gw.sessions.value"
      :loading="gw.loading.value"
      :error="gw.error.value"
      :relative-time="gw.relativeTime"
      :model-short="gw.modelShort"
      @open="openSession"
      @refresh="refreshSessions"
      @disconnect="disconnect"
    />

    <!-- Chat -->
    <MessageView
      v-else-if="view === 'chat'"
      :messages="gw.messages.value"
      :loading="gw.loading.value"
      :error="gw.error.value"
      :sending="sending"
      :format-time="gw.formatTime"
      @back="goBack"
      @send="handleSend"
    />
  </div>
</template>

<style>
/* Global styles (non-scoped) */
@import './assets/main.css';

.Root {
  background-color: var(--bg);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.StateView {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.Loader {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
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
const connectLoading = ref(false)
const connectError = ref('')
const isNewSession = ref(false)

const selectedSessionTitle = computed(() => {
  if (!selectedSessionId.value) return 'Session'
  const s = gw.sessions.value.find(s => s.id === selectedSessionId.value)
  return s?.title || 'Session'
})

async function startGateway() {
  await gw.connectWs(
    auth.gatewayUrl.value,
    auth.sessionCookie.value,
    auth.fetchWsTicket,
  )
}

// ── Boot ───────────────────────────────────────────
onMounted(async () => {
  const bootTimer = setTimeout(() => {
    if (view.value === 'loading') {
      console.warn('[boot] stuck on loading, forcing connect view')
      view.value = 'connect'
    }
  }, 5000)

  try {
    const ok = await auth.tryAutoLogin()
    if (ok) {
      await gw.fetchSessions(auth.gatewayUrl.value)
      await startGateway()
      view.value = 'sessions'
    } else {
      view.value = 'connect'
    }
  } catch (err: any) {
    console.error('[boot] unexpected error:', err)
    view.value = 'connect'
  } finally {
    clearTimeout(bootTimer)
  }
})

onUnmounted(() => {
  gw.disconnectWs()
})

// ── Connect ────────────────────────────────────────
async function handleConnect(url: string, user: string, pass: string) {
  connectLoading.value = true
  connectError.value = ''

  auth.gatewayUrl.value = url
  auth.username.value = user
  auth.password.value = pass

  try {
    await auth.connect()
    await gw.fetchSessions(url)
    await startGateway()
    view.value = 'sessions'
  } catch (err: any) {
    const msg = err.message || 'Connection failed'
    connectError.value = msg
  } finally {
    connectLoading.value = false
  }
}

// ── Sessions ───────────────────────────────────────
async function refreshSessions() {
  try {
    await gw.fetchSessions(auth.gatewayUrl.value)
  } catch (err: any) {
    alert('Failed to refresh: ' + (err.message || 'Unknown error'))
  }
}

function openSession(id: string) {
  selectedSessionId.value = id
  view.value = 'chat'
  gw.fetchMessages(auth.gatewayUrl.value, id).catch(err => {
    alert('Failed to load messages: ' + (err.message || 'Unknown error'))
  })
}

function goBack() {
  selectedSessionId.value = ''
  isNewSession.value = false
  gw.messages.value = []
  view.value = 'sessions'
}

function createNewSession() {
  selectedSessionId.value = ''
  isNewSession.value = true
  gw.messages.value = []
  view.value = 'chat'
}

async function deleteSession(id: string) {
  const ok = await gw.deleteSession(auth.gatewayUrl.value, id)
  if (!ok) alert('Failed to delete session')
}

function disconnect() {
  gw.disconnectWs()
  auth.clearSession()
  gw.sessions.value = []
  gw.messages.value = []
  selectedSessionId.value = ''
  view.value = 'connect'
}

// ── Chat ───────────────────────────────────────────
async function handleSend(text: string) {
  if (sending.value) return
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
  try {
    const result = await gw.sendMessage(auth.gatewayUrl.value, selectedSessionId.value, text, isNewSession.value)
    // If this was a new session, update the ID with the server-assigned one
    if (result?.newSessionId) {
      selectedSessionId.value = result.newSessionId
      isNewSession.value = false
    }
  } catch (err: any) {
    gw.messages.value.push({
      role: 'assistant',
      content: 'Failed to send: ' + (err.message || 'Unknown error'),
      timestamp: Date.now() / 1000,
    })
    alert('Send failed: ' + (err.message || 'Unknown error'))
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
      :loading="connectLoading"
      :error="connectError"
      @connect="handleConnect"
    />

    <!-- Sessions -->
    <SessionsView
      v-else-if="view === 'sessions'"
      :sessions="gw.sessions.value"
      :loading="gw.loading.value"
      :error="gw.error.value"
      :connected="auth.isConnected.value"
      :ws-state="gw.wsState.value"
      :gateway-url="auth.gatewayUrl.value"
      :relative-time="gw.relativeTime"
      :model-short="gw.modelShort"
      @open="openSession"
      @refresh="refreshSessions"
      @disconnect="disconnect"
      @new-session="createNewSession"
      @delete-session="deleteSession"
    />

    <!-- Chat -->
    <MessageView
      v-else-if="view === 'chat'"
      :messages="gw.messages.value"
      :loading="gw.loading.value"
      :error="gw.error.value"
      :sending="sending"
      :format-time="gw.formatTime"
      :session-title="selectedSessionTitle"
      @back="goBack"
      @send="handleSend"
    />
  </div>
</template>

<style>
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

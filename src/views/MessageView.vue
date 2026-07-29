<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { renderMarkdown } from '../utils/markdown'
import { isNearChatBottom } from '../utils/chatScroll'
import { useAuth } from '../composables/useAuth'
import { useGateway, type ModelProvider } from '../composables/useGateway'
import { useToast } from '../composables/useToast'
import { openUrl } from '@tauri-apps/plugin-opener'

const router = useRouter()
const route = useRoute()
const auth = useAuth()
const toast = useToast()
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
      toast.show(err.message || 'Failed to load messages', 'error')
    }
  }
  // Load current model for the pill
  loadModels()

  // Keyboard overlap handling for mobile
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewportResize)
    onViewportResize()
  }
})

onUnmounted(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewportResize)
  }
})

function onViewportResize() {
  const vh = window.visualViewport?.height || window.innerHeight
  document.documentElement.style.setProperty('--app-height', `${vh}px`)
}

const input = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
// ── User message editing ──
const editingIdx = ref<number | null>(null)
const editText = ref('')
const editEl = ref<HTMLTextAreaElement | null>(null)
const editing = ref(false)

function startEdit(idx: number) {
  const msg = gw.messages.value[idx]
  if (!msg || msg.role !== 'user') return
  editingIdx.value = idx
  editText.value = msg.content
  nextTick(() => {
    editEl.value?.focus()
    editEl.value?.select()
  })
}

function cancelEdit() {
  editingIdx.value = null
  editText.value = ''
}

async function saveEdit() {
  const idx = editingIdx.value
  if (idx === null || !selectedSessionId.value || editing.value) return
  const text = editText.value.trim()
  if (!text) return

  editing.value = true
  try {
    await gw.editMessage(auth.gatewayUrl.value, selectedSessionId.value, idx, text)
  } catch (err: any) {
    toast.show(err.message || 'Edit failed', 'error')
  } finally {
    editing.value = false
    editingIdx.value = null
    editText.value = ''
  }
}

function handleEditKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    saveEdit()
  } else if (e.key === 'Escape') {
    cancelEdit()
  }
}

function autoResizeEdit() {
  if (!editEl.value) return
  editEl.value.style.height = 'auto'
  editEl.value.style.height = Math.min(editEl.value.scrollHeight, 120) + 'px'
}

// Watch for route changes (navigating between sessions without remount)
watch(() => route.params.id, async (newId) => {
  selectedSessionId.value = (newId as string) || ''
  isNewSession.value = !selectedSessionId.value
  gw.messages.value = []
  searchQuery.value = ''
  editingIdx.value = null
  editText.value = ''
  matchIndices.value = []
  currentMatchIdx.value = -1
  shouldFollowMessages.value = true
  if (selectedSessionId.value) {
    try {
      await gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId.value)
    } catch (err: any) {
      toast.show(err.message || 'Failed to load messages', 'error')
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

function sendText(text: string, preserveUserMessage = false) {
  sending.value = true
  shouldFollowMessages.value = true

  // Generate session ID for new sessions
  if (!selectedSessionId.value) {
    selectedSessionId.value = crypto.randomUUID()
  }

  // A failed turn already has its user message in the thread. Preserve that
  // record when retrying so the chat does not display the same prompt twice.
  if (!preserveUserMessage) {
    gw.messages.value.push({
      role: 'user',
      content: text,
      timestamp: Date.now() / 1000,
    })
  }

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
      const message = err.message || 'Unknown error'
      // sendMessage adds an assistant bubble before submitting. Retain any
      // streamed partial response and make that same bubble retryable instead
      // of appending a duplicate error after it.
      const last = gw.messages.value[gw.messages.value.length - 1]
      if (last?.role === 'assistant') {
        if (!last.content) last.content = message
        last.error = true
      } else {
        gw.messages.value.push({
          role: 'assistant',
          content: message,
          timestamp: Date.now() / 1000,
          error: true,
        })
      }
    })
    .finally(() => {
      sending.value = false
    })
}

function retryFailed(failedMsgIdx: number) {
  if (sending.value) return
  // Find the user message that preceded this failed assistant message.
  for (let i = failedMsgIdx - 1; i >= 0; i--) {
    if (gw.messages.value[i].role === 'user') {
      const userText = gw.messages.value[i].content
      // Keep the original user message and replace only its failed response.
      gw.messages.value.splice(failedMsgIdx, 1)
      sendText(userText, true)
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
const shouldFollowMessages = ref(true)

function checkScrollPosition() {
  const el = scrollEl.value
  if (!el) return
  shouldFollowMessages.value = isNearChatBottom(el)
  showJumpToBottom.value = !shouldFollowMessages.value
}

function scrollToBottom() {
  const el = scrollEl.value
  if (!el) return
  shouldFollowMessages.value = true
  showJumpToBottom.value = false
  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}

// Update jump-to-bottom visibility on scroll
function onScroll() {
  checkScrollPosition()
}

// ── Pull-to-refresh in chat ──
const pullStart = ref(0)
const pullDelta = ref(0)

function onChatTouchStart(e: TouchEvent) {
  if (scrollEl.value && scrollEl.value.scrollTop === 0) {
    pullStart.value = e.touches[0].clientY
  }
}

function onChatTouchMove(e: TouchEvent) {
  if (pullStart.value === 0) return
  const delta = e.touches[0].clientY - pullStart.value
  if (delta > 0 && scrollEl.value && scrollEl.value.scrollTop === 0) {
    pullDelta.value = Math.min(delta * 0.5, 80)
  }
}

async function onChatTouchEnd() {
  if (pullDelta.value > 50 && selectedSessionId.value) {
    await gw.fetchMessages(auth.gatewayUrl.value, selectedSessionId.value)
  }
  pullStart.value = 0
  pullDelta.value = 0
}

function autoResize() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 120) + 'px'
}

function render(content: string): string {
  return renderMarkdown(content)
}

// Desktop opens rendered images in a dedicated zoomable viewer. Keep the mobile
// equivalent local to the message surface so the markdown renderer stays pure.
const imagePreview = ref<{ src: string; alt: string } | null>(null)

function openImagePreview(image: HTMLImageElement) {
  const src = image.currentSrc || image.src
  if (!src) return
  imagePreview.value = { src, alt: image.alt || 'Image preview' }
}

function closeImagePreview() {
  imagePreview.value = null
}

function handleMessagesClick(e: Event) {
  const clickedImage = (e.target as HTMLElement).closest('img.md-img') as HTMLImageElement | null
  if (clickedImage) {
    e.preventDefault()
    e.stopPropagation()
    openImagePreview(clickedImage)
    return
  }

  const clickedLink = (e.target as HTMLElement).closest('a.md-link') as HTMLAnchorElement | null
  if (clickedLink) {
    e.preventDefault()
    e.stopPropagation()
    try {
      const url = new URL(clickedLink.href)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Unsupported link')
      openUrl(url.href).catch(() => toast.show('Unable to open link', 'error'))
    } catch {
      toast.show('Invalid link', 'error')
    }
    return
  }

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

// ── Message Action Sheet ──
const actionSheetOpen = ref(false)
const actionSheetMsgIdx = ref<number>(-1)
const actionSheetMsg = computed(() => {
  if (actionSheetMsgIdx.value < 0) return null
  return gw.messages.value[actionSheetMsgIdx.value] || null
})
const actionSheetIsLastAssistant = computed(() => {
  const msgs = gw.messages.value
  const idx = actionSheetMsgIdx.value
  return idx >= 0 && msgs[idx]?.role === 'assistant' && idx === msgs.length - 1
})

const hasShareApi = typeof navigator !== 'undefined' && !!navigator.share

let longPressTimer: ReturnType<typeof setTimeout> | null = null

function handleMessageLongPress(e: TouchEvent, idx: number) {
  const touch = e.touches[0]
  longPressTimer = setTimeout(() => {
    openActionSheet(idx)
  }, 500)
  // Store start position to detect movement
  const startY = touch.clientY
  const onMove = (ev: TouchEvent) => {
    if (Math.abs(ev.touches[0].clientY - startY) > 10) {
      clearTimeout(longPressTimer!)
      longPressTimer = null
    }
  }
  const onEnd = () => {
    clearTimeout(longPressTimer!)
    longPressTimer = null
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', onEnd)
  }
  document.addEventListener('touchmove', onMove)
  document.addEventListener('touchend', onEnd)
}

function handleMessageTouchEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

function openActionSheet(idx: number) {
  actionSheetMsgIdx.value = idx
  actionSheetOpen.value = true
}

function closeActionSheet() {
  actionSheetOpen.value = false
  actionSheetMsgIdx.value = -1
}

async function actionCopyText() {
  const msg = actionSheetMsg.value
  if (msg?.content) {
    await navigator.clipboard.writeText(msg.content)
    toast.show('Copied to clipboard', 'success')
  }
  closeActionSheet()
}

function actionEdit() {
  const idx = actionSheetMsgIdx.value
  closeActionSheet()
  startEdit(idx)
}

function actionRetry() {
  const idx = actionSheetMsgIdx.value
  closeActionSheet()
  retryFailed(idx)
}

async function actionRegenerate() {
  closeActionSheet()
  await handleRegenerate()
}

async function actionShare() {
  const msg = actionSheetMsg.value
  if (msg?.content && navigator.share) {
    try {
      await navigator.share({ text: msg.content })
    } catch { /* cancelled */ }
  }
  closeActionSheet()
}

async function actionRestore() {
  const idx = actionSheetMsgIdx.value
  const msg = actionSheetMsg.value
  closeActionSheet()

  if (sending.value || !selectedSessionId.value || !msg || msg.role !== 'user') return
  if (!window.confirm('Restore from this message? Messages after it will be replaced.')) return

  const originalMessages = [...gw.messages.value]
  sending.value = true
  shouldFollowMessages.value = true
  try {
    await gw.restoreMessage(auth.gatewayUrl.value, selectedSessionId.value, idx)
  } catch (err: any) {
    // A failed truncating submit must not leave the local timeline pretending
    // the restore succeeded; desktop restores the prior authoritative view too.
    gw.messages.value = originalMessages
    toast.show(err.message || 'Restore failed', 'error')
  } finally {
    sending.value = false
  }
}

function isThinking(content: string): boolean {
  return content.includes('<think>') && !content.includes('</think>')
}

const hasMessages = computed(() => gw.messages.value.length > 0)

// Keep the currently streaming tail fully laid out, while allowing Chromium to
// skip paint and layout work for settled history. This follows desktop's thread
// list strategy: virtualising a turn still receiving deltas can preserve an old
// intrinsic height and make the scroll position drift.
const LIVE_TAIL_MESSAGES = 12
function shouldVirtualizeMessage(idx: number): boolean {
  return idx < gw.messages.value.length - LIVE_TAIL_MESSAGES
}

// ── Date separators ──
function getDateLabel(ts: number): string {
  if (!ts) return ''
  const date = new Date(ts * 1000)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)

  if (date >= startOfToday) return 'Today'
  if (date >= startOfYesterday) return 'Yesterday'

  const diff = Math.floor((startOfToday.getTime() - date.getTime()) / 86400000)
  if (diff < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function showDateSeparator(idx: number): boolean {
  const msgs = gw.messages.value
  if (idx === 0) return !!msgs[0]?.timestamp
  const prev = msgs[idx - 1]
  const curr = msgs[idx]
  if (!prev?.timestamp || !curr?.timestamp) return false
  const prevDate = new Date(prev.timestamp * 1000)
  const currDate = new Date(curr.timestamp * 1000)
  return prevDate.toDateString() !== currDate.toDateString()
}

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

// Keep following only while the reader is already at the newest messages.
// This mirrors the desktop thread: a new streamed turn must not pull someone
// reading older context back to the composer.
watch(() => gw.messages.value.length, async () => {
  await nextTick()
  const el = scrollEl.value
  if (el && shouldFollowMessages.value) {
    el.scrollTop = el.scrollHeight
  }
})

// Streaming updates grow the final bubble without stealing the reader's place.
watch(() => {
  const msgs = gw.messages.value
  if (msgs.length === 0) return ''
  return msgs[msgs.length - 1].content
}, async () => {
  await nextTick()
  const el = scrollEl.value
  if (el && shouldFollowMessages.value) {
    el.scrollTop = el.scrollHeight
  }
})

// ── Export Chat ─────────────────────────────────────
// Keep the portable export aligned with desktop: structured data remains useful
// after it leaves the app, unlike a rendered transcript that loses message roles
// and timestamps.
function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

async function exportChat() {
  const msgs = gw.messages.value
  if (!msgs.length) {
    toast.show('No messages to export', 'info')
    return
  }

  const title = selectedSessionTitle.value || 'Hermes Chat'
  const session = gw.sessions.value.find(item => item.id === selectedSessionId.value) || null
  const fileName = `${sanitizeFilenamePart(title) || 'session'}-${sanitizeFilenamePart(selectedSessionId.value).slice(0, 8) || 'chat'}.json`
  const serialized = JSON.stringify({
    exported_at: new Date().toISOString(),
    session_id: selectedSessionId.value || null,
    title,
    session,
    message_count: msgs.length,
    messages: msgs,
  }, null, 2)

  try {
    const file = new File([serialized], fileName, { type: 'application/json' })
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ title, files: [file] })
      return
    }

    // Some Android WebViews cannot share files but can still send text to a
    // target app. Preserve the complete JSON instead of silently degrading it.
    if (navigator.share) {
      await navigator.share({ title, text: serialized })
      return
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(serialized)
      toast.show('Chat JSON copied to clipboard', 'success')
      return
    }

    toast.show('Export not available on this device', 'error')
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(serialized)
        toast.show('Chat JSON copied to clipboard', 'success')
      } else {
        toast.show(err?.message || 'Export failed', 'error')
      }
    } catch {
      toast.show('Export failed', 'error')
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
    toast.show(err.message || 'Regenerate failed', 'error')
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
    <div class="chat-messages" ref="scrollEl" @scroll="onScroll" @click="handleMessagesClick" @touchstart="onChatTouchStart" @touchmove="onChatTouchMove" @touchend="onChatTouchEnd">
      <!-- Pull-to-refresh indicator -->
      <div
        v-if="pullDelta > 0"
        class="pull-refresh-indicator"
        :style="{ height: pullDelta + 'px', opacity: pullDelta / 80 }"
      >
        <div class="pull-spinner" :class="{ active: gw.loadingMessages.value }" />
      </div>

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

      <template
        v-for="(msg, idx) in gw.messages.value"
        :key="idx"
      >
      <!-- Date separator -->
      <div v-if="showDateSeparator(idx)" class="date-separator">
        <span class="date-separator-line" />
        <span class="date-separator-label">{{ getDateLabel(msg.timestamp) }}</span>
        <span class="date-separator-line" />
      </div>

      <div
        :data-msg-idx="idx"
        class="message"
        :class="[
          msg.role,
          {
            'search-match': isMatch(idx),
            'search-current': matchIndices[currentMatchIdx] === idx,
            'message-virtualized': shouldVirtualizeMessage(idx),
          },
        ]"
      >
        <div
          class="message-bubble"
          :class="[msg.role, { error: msg.error, editing: editingIdx === idx }]"
          @touchstart="handleMessageLongPress($event, idx)"
          @touchend="handleMessageTouchEnd"
          @touchmove="handleMessageTouchEnd"
        >
          <!-- Edit mode for user messages -->
          <div v-if="editingIdx === idx" class="edit-mode">
            <textarea
              ref="editEl"
              v-model="editText"
              class="edit-textarea"
              rows="1"
              @keydown="handleEditKeydown"
              @input="autoResizeEdit"
            ></textarea>
            <div class="edit-actions">
              <button class="edit-action-btn cancel" @click="cancelEdit" :disabled="editing">Cancel</button>
              <button class="edit-action-btn save" @click="saveEdit" :disabled="editing || !editText.trim()">
                <span v-if="editing" class="spinner-sm"></span>
                <span v-else>Send</span>
              </button>
            </div>
          </div>

          <!-- Normal content (not editing) -->
          <template v-else>
            <!-- Tool results are durable session records, not hidden transport noise. -->
            <details v-if="msg.role === 'tool'" class="tool-message">
              <summary>
                <span class="tool-status-dot">✓</span>
                <span>{{ msg.toolName || 'Tool' }}</span>
                <span class="tool-result-label">completed</span>
              </summary>
              <pre v-if="msg.content" class="tool-output">{{ msg.content }}</pre>
            </details>

            <template v-else>
              <!-- The gateway sends reasoning in dedicated fields, not only <think> tags. -->
              <details v-if="msg.reasoning" class="reasoning-message">
                <summary>Thought</summary>
                <div class="reasoning-content">{{ msg.reasoning }}</div>
              </details>

              <div v-if="msg.role === 'assistant' && msg.toolCalls?.length" class="tool-call-list">
                <span v-for="tool in msg.toolCalls" :key="tool.id" class="tool-call-chip">{{ tool.name }}</span>
              </div>

              <!-- Error state -->
              <div v-if="msg.error" class="error-content">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span class="error-text">{{ msg.content || 'Failed to send' }}</span>
                <button class="retry-btn" :disabled="sending" @click.stop="retryFailed(idx)">Retry</button>
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
                v-if="msg.content"
                class="md-content"
                v-html="searchQuery.trim() && isMatch(idx) ? highlightText(msg.content, searchQuery) : render(msg.content)"
              ></div>

              <!-- Empty assistant placeholder (streaming start) -->
              <div v-if="msg.role === 'assistant' && !msg.content && !msg.reasoning && !msg.toolCalls?.length" class="typing-dots">
                <span></span><span></span><span></span>
              </div>
            </template>
          </template>
        </div>

        <div class="message-footer" :class="msg.role">
          <span v-if="msg.timestamp" class="message-time">{{ formatTime(msg.timestamp) }}</span>
          <button
            class="menu-btn"
            @click.stop="openActionSheet(idx)"
            title="Actions"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" />
            </svg>
          </button>
        </div>
      </div>
      </template>

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

    <!-- Image preview -->
    <Teleport to="body">
      <Transition name="image-preview-fade">
        <div v-if="imagePreview" class="ImagePreviewOverlay" @click="closeImagePreview">
          <button class="ImagePreviewClose" aria-label="Close image preview" @click="closeImagePreview">✕</button>
          <img
            class="ImagePreviewImage"
            :src="imagePreview.src"
            :alt="imagePreview.alt"
            @click.stop
          />
        </div>
      </Transition>
    </Teleport>

    <!-- Message Action Sheet -->
    <Teleport to="body">
      <Transition name="sheet-fade">
        <div v-if="actionSheetOpen" class="ActionSheetOverlay" @click="closeActionSheet">
          <div class="ActionSheet" @click.stop>
            <div class="ActionSheetHandle" />
            <div class="ActionSheetPreview" v-if="actionSheetMsg">
              <span class="ActionSheetRole">{{ actionSheetMsg.role === 'user' ? 'You' : 'Assistant' }}</span>
              <span class="ActionSheetSnippet">{{ (actionSheetMsg.content || '').slice(0, 120) }}{{ (actionSheetMsg.content || '').length > 120 ? '…' : '' }}</span>
            </div>
            <div class="ActionSheetActions">
              <button class="ActionSheetBtn" @click="actionCopyText">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                <span>Copy text</span>
              </button>
              <button
                v-if="actionSheetMsg?.role === 'user' && !sending && editingIdx === null && !actionSheetMsg?.error"
                class="ActionSheetBtn"
                @click="actionEdit"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <span>Edit message</span>
              </button>
              <button
                v-if="actionSheetMsg?.error && !sending"
                class="ActionSheetBtn"
                @click="actionRetry"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                <span>Retry</span>
              </button>
              <button
                v-if="actionSheetIsLastAssistant && !sending && actionSheetMsg?.content"
                class="ActionSheetBtn"
                @click="actionRegenerate"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                <span>Regenerate</span>
              </button>
              <button
                v-if="actionSheetMsg?.content && hasShareApi"
                class="ActionSheetBtn"
                @click="actionShare"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                <span>Share</span>
              </button>
              <button
                v-if="actionSheetMsg?.role === 'user' && !sending && selectedSessionId"
                class="ActionSheetBtn danger"
                @click="actionRestore"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3.5 13A9 9 0 1 0 6 6.5L3 10"/></svg>
                <span>Restore from here</span>
              </button>
            </div>
            <button class="ActionSheetCancel" @click="closeActionSheet">Cancel</button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.chat-view {
  display: flex;
  flex-direction: column;
  height: var(--app-height, 100%);
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

/* Date separators */
.date-separator {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0 4px;
}
.date-separator-line {
  flex: 1;
  height: 1px;
  background: var(--border);
}
.date-separator-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
  flex-shrink: 0;
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

.pull-refresh-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  transition: height 0.1s ease;
}
.pull-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
}
.pull-spinner.active {
  animation: spin 0.8s linear infinite;
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
/* Chromium preserves a settled intrinsic height while skipping off-screen work. */
.message-virtualized {
  content-visibility: auto;
  contain-intrinsic-size: auto 260px;
}
.message.user { align-items: flex-end; }
.message.assistant { align-items: flex-start; }
.message.tool { align-items: stretch; padding: 0 2px; }

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
.message-bubble.tool {
  width: 100%;
  max-width: 100%;
  padding: 0;
  background: transparent;
  border: 0;
}

/* Durable reasoning and tool records */
.reasoning-message,
.tool-message {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--surface) 88%, var(--accent));
  overflow: hidden;
}
.reasoning-message { margin: 0 0 8px; }
.reasoning-message summary,
.tool-message summary {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 7px 10px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  list-style: none;
}
.reasoning-message summary::before { content: '◈'; color: var(--accent); }
.tool-message summary::-webkit-details-marker,
.reasoning-message summary::-webkit-details-marker { display: none; }
.reasoning-content {
  padding: 0 10px 10px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.tool-status-dot { color: var(--success); font-size: 11px; }
.tool-result-label { margin-left: auto; color: var(--text-muted); opacity: .7; font-size: 11px; }
.tool-output {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border-top: 1px solid var(--border);
  color: #b9bbc8;
  background: var(--bg);
  font: 11px/1.5 'SF Mono', 'Fira Code', monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.tool-call-list { display: flex; flex-wrap: wrap; gap: 5px; margin: 0 0 8px; }
.tool-call-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 7px;
  color: var(--text-muted);
  background: var(--surface-3);
  font: 11px/1.1 'SF Mono', 'Fira Code', monospace;
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
  margin-left: auto;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.25);
  border-radius: 5px;
  color: var(--error);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.retry-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.retry-btn:hover:not(:disabled) {
  color: #fff;
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.4);
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
.message-bubble :deep(.md-img) {
  cursor: zoom-in;
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

/* ── User message editing ── */
.edit-btn:hover {
  color: var(--accent) !important;
  border-color: var(--accent) !important;
  background: rgba(94, 106, 210, 0.08) !important;
}
.message-bubble.editing {
  background: var(--surface-2) !important;
  border-color: var(--accent) !important;
}
.edit-mode {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.edit-textarea {
  width: 100%;
  min-height: 36px;
  max-height: 120px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  color: var(--text);
  font-size: 14px;
  line-height: 1.4;
  resize: none;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.edit-textarea:focus {
  border-color: var(--accent);
}
.edit-textarea::placeholder {
  color: var(--text-muted);
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.edit-action-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: none;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
}
.edit-action-btn.cancel {
  color: var(--text-muted);
}
.edit-action-btn.cancel:hover {
  color: var(--text);
  border-color: var(--text-muted);
}
.edit-action-btn.save {
  color: #fff;
  background: var(--accent);
  border-color: var(--accent);
}
.edit-action-btn.save:hover:not(:disabled) {
  background: var(--accent-hover);
}
.edit-action-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
/* Message bubble editing override for user messages */
.message.user .message-bubble.editing {
  background: var(--surface-2);
  color: var(--text);
  border-color: var(--accent);
  border-bottom-right-radius: 14px;
}

/* ── Menu button in message footer ── */
.menu-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}
.message:hover .menu-btn,
.menu-btn:focus-visible {
  opacity: 1;
}
/* Always visible on touch devices */
@media (hover: none) {
  .menu-btn { opacity: 0.6; }
  .menu-btn:active { opacity: 1; }
}

/* ── Image preview ── */
.ImagePreviewOverlay {
  position: fixed;
  inset: 0;
  z-index: 2100;
  display: grid;
  place-items: center;
  padding: 24px;
  padding-top: max(24px, env(safe-area-inset-top, 0px));
  padding-bottom: max(24px, env(safe-area-inset-bottom, 0px));
  background: rgba(0, 0, 0, 0.82);
}
.ImagePreviewImage {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  cursor: zoom-out;
}
.ImagePreviewClose {
  position: absolute;
  top: max(12px, env(safe-area-inset-top, 0px));
  right: 12px;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--surface);
  color: var(--text);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.image-preview-fade-enter-active,
.image-preview-fade-leave-active { transition: opacity 0.16s ease; }
.image-preview-fade-enter-from,
.image-preview-fade-leave-to { opacity: 0; }

/* ── Action Sheet ── */
.ActionSheetOverlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 2000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.ActionSheet {
  width: 100%;
  max-width: 400px;
  background: var(--surface);
  border-radius: 16px 16px 0 0;
  padding: 8px 12px calc(env(safe-area-inset-bottom, 0px) + 12px);
  display: flex;
  flex-direction: column;
  animation: sheetSlideUp 0.22s ease;
}
@keyframes sheetSlideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}
.ActionSheetHandle {
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
  margin: 4px auto 10px;
  flex-shrink: 0;
}
.ActionSheetPreview {
  padding: 8px 12px 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ActionSheetRole {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
}
.ActionSheetSnippet {
  font-size: 13px;
  color: var(--text);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
.ActionSheetActions {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 0;
}
.ActionSheetBtn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  border-radius: 10px;
  background: none;
  color: var(--text);
  font-size: 15px;
  cursor: pointer;
  transition: background 0.12s;
  text-align: left;
}
.ActionSheetBtn:hover {
  background: var(--surface-2);
}
.ActionSheetBtn:active {
  background: var(--surface-3, var(--surface-2));
}
.ActionSheetBtn.danger {
  color: var(--error);
}
.ActionSheetBtn svg {
  flex-shrink: 0;
}
.ActionSheetCancel {
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 10px;
  background: var(--surface-2);
  color: var(--text);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 6px;
  transition: background 0.12s;
}
.ActionSheetCancel:hover {
  background: var(--surface-3, var(--surface-2));
}

/* Sheet transition */
.sheet-fade-enter-active { transition: opacity 0.2s ease; }
.sheet-fade-leave-active { transition: opacity 0.15s ease; }
.sheet-fade-enter-from,
.sheet-fade-leave-to { opacity: 0; }
</style>
